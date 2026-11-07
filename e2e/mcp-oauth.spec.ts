import type { APIRequestContext } from "@playwright/test";

import { pkcePair } from "../src/lib/oauth";
import { call, rpc } from "./mcp";
import { expect, test } from "./fixtures";
import { miniBotToken, openMini } from "./mini";

// OAuth for Claude.ai / ChatGPT connectors (issue #152): discovery, registration, the
// consent decision (with the seeded user's session cookie), PKCE code exchange, refresh
// rotation and revocation, then a real tool call with the access token.
const REDIRECT = "http://localhost:8765/callback";

async function register(request: APIRequestContext, redirect = REDIRECT) {
  const res = await request.post("/api/oauth/register", {
    data: { client_name: "E2E Claude", redirect_uris: [redirect] },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

function authorizeQuery(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "records:read records:write",
    state: "st-1",
    ...extra,
  });
}

/** Approves through the consent endpoint as the seeded user; returns the code it hands back. */
async function approve(
  request: APIRequestContext,
  sessionToken: string,
  query: URLSearchParams,
  body: object,
) {
  const res = await request.post("/api/oauth/consent", {
    headers: { cookie: `session=${sessionToken}` },
    data: { params: Object.fromEntries(query), approve: true, ...body },
  });
  expect(res.status(), await res.text()).toBe(200);
  const url = new URL(((await res.json()) as { redirectTo: string }).redirectTo);
  expect(url.origin + url.pathname).toBe(REDIRECT);
  expect(url.searchParams.get("state")).toBe("st-1");
  expect(url.searchParams.get("iss")).toBeTruthy();
  return url.searchParams.get("code")!;
}

const form = (data: Record<string, string>) => ({
  headers: { "content-type": "application/x-www-form-urlencoded" },
  data: new URLSearchParams(data).toString(),
});

test.describe("MCP OAuth", () => {
  test("discovery points /api/mcp at the authorization server", async ({ request }) => {
    const pr = await request.get("/.well-known/oauth-protected-resource");
    expect(pr.status()).toBe(200);
    const prBody = await pr.json();
    expect(prBody.resource).toMatch(/\/api\/mcp$/);

    const as = await request.get("/.well-known/oauth-authorization-server");
    const meta = await as.json();
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    expect(meta.registration_endpoint).toMatch(/\/api\/oauth\/register$/);

    const res = await request.post("/api/mcp", { data: {} });
    expect(res.status()).toBe(401);
    expect(res.headers()["www-authenticate"]).toContain("resource_metadata=");
  });

  test("full flow: authorize, exchange with PKCE, call a tool, refresh, revoke", async ({
    request,
    seeded,
    dbPool,
  }) => {
    const clientId = await register(request);
    const { verifier, challenge } = pkcePair();
    const query = authorizeQuery(clientId, challenge);

    // /authorize only forwards to the consent page.
    const authz = await request.get(`/api/oauth/authorize?${query}`, { maxRedirects: 0 });
    expect(authz.status()).toBe(307);
    expect(authz.headers().location).toContain("/app/oauth/consent");

    const code = await approve(request, seeded.sessionToken, query, {
      access: "write",
      allGroups: false,
      groupIds: [seeded.groupId],
    });
    // Approving alone creates no connection.
    const before = await dbPool.query(
      "SELECT 1 FROM mcp_connections WHERE user_id=$1 AND kind='oauth'",
      [seeded.userId],
    );
    expect(before.rowCount).toBe(0);

    const tokenReq = {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
    };
    // A wrong verifier fails — and burns the code.
    const wrong = await request.post(
      "/api/oauth/token",
      form({ ...tokenReq, code_verifier: pkcePair().verifier }),
    );
    expect(wrong.status()).toBe(400);
    expect((await wrong.json()).error).toBe("invalid_grant");
    const burnt = await request.post(
      "/api/oauth/token",
      form({ ...tokenReq, code_verifier: verifier }),
    );
    expect(burnt.status()).toBe(400);

    // A fresh approval, exchanged properly.
    const code2 = await approve(request, seeded.sessionToken, query, {
      access: "write",
      allGroups: false,
      groupIds: [seeded.groupId],
    });
    const ok = await request.post(
      "/api/oauth/token",
      form({ ...tokenReq, code: code2, code_verifier: verifier }),
    );
    expect(ok.status(), await ok.text()).toBe(200);
    const tokens = await ok.json();
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.expires_in).toBe(3600);

    const conn = await dbPool.query(
      "SELECT id, name, kind, access, group_ids, token_hash FROM mcp_connections WHERE user_id=$1 AND kind='oauth' AND revoked_at IS NULL",
      [seeded.userId],
    );
    expect(conn.rows).toHaveLength(1);
    expect(conn.rows[0]).toMatchObject({ name: "E2E Claude", access: "write", token_hash: null });
    expect(conn.rows[0].group_ids).toEqual([seeded.groupId]);

    // The access token drives the same tools, inside the approved scope.
    const groups = await call(request, tokens.access_token, "list_groups", {});
    expect(groups.structuredContent!.groups.map((g: { groupId: number }) => g.groupId)).toEqual([
      seeded.groupId,
    ]);
    const outside = await call(request, tokens.access_token, "get_group", {
      groupId: seeded.foreignGroupId,
    });
    expect(outside.isError).toBe(true);

    // Refresh rotates; the spent refresh token ends the connection when replayed.
    const refreshed = await request.post(
      "/api/oauth/token",
      form({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      }),
    );
    expect(refreshed.status(), await refreshed.text()).toBe(200);
    const next = await refreshed.json();
    expect(next.access_token).not.toBe(tokens.access_token);
    const replay = await request.post(
      "/api/oauth/token",
      form({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      }),
    );
    expect(replay.status()).toBe(400);
    const dead = await rpc(request, next.access_token, "tools/list");
    expect(dead.status()).toBe(401);
  });

  test("revoking ends the access token, and so does revoking in settings", async ({
    request,
    seeded,
  }) => {
    const clientId = await register(request);
    const { verifier, challenge } = pkcePair();
    const query = authorizeQuery(clientId, challenge);
    const code = await approve(request, seeded.sessionToken, query, {
      access: "read",
      allGroups: false,
      groupIds: [seeded.groupId],
    });
    const res = await request.post(
      "/api/oauth/token",
      form({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
      }),
    );
    const tokens = await res.json();
    expect((await rpc(request, tokens.access_token, "tools/list")).status()).toBe(200);

    const revoked = await request.post(
      "/api/oauth/revoke",
      form({ token: tokens.access_token, client_id: clientId }),
    );
    expect(revoked.status()).toBe(200);
    expect((await rpc(request, tokens.access_token, "tools/list")).status()).toBe(401);
    const again = await request.post(
      "/api/oauth/token",
      form({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      }),
    );
    expect(again.status()).toBe(400);
  });

  test("a read-only approval can't write, whatever the client asked for", async ({
    request,
    seeded,
  }) => {
    const clientId = await register(request);
    const { verifier, challenge } = pkcePair();
    const query = authorizeQuery(clientId, challenge);
    const code = await approve(request, seeded.sessionToken, query, {
      access: "read",
      allGroups: false,
      groupIds: [seeded.groupId],
    });
    const tokens = await (
      await request.post(
        "/api/oauth/token",
        form({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT,
          client_id: clientId,
          code_verifier: verifier,
        }),
      )
    ).json();
    const write = await call(request, tokens.access_token, "add_expense", {
      groupId: seeded.groupId,
      amount: 10,
    });
    expect(write.structuredContent!.error.code).toBe("forbidden");
  });

  test("an unregistered redirect URI is an error page, never a redirect", async ({ request }) => {
    const clientId = await register(request);
    const { challenge } = pkcePair();
    const q = authorizeQuery(clientId, challenge, { redirect_uri: "https://evil.example/cb" });
    const res = await request.get(`/api/oauth/authorize?${q}`, { maxRedirects: 0 });
    expect(res.status()).toBe(400);
    expect(res.headers().location).toBeUndefined();

    const noPkce = authorizeQuery(clientId, challenge);
    noPkce.delete("code_challenge");
    const missing = await request.get(`/api/oauth/authorize?${noPkce}`, { maxRedirects: 0 });
    // The redirect URI is trusted here, so the error goes back to the client.
    expect(missing.status()).toBe(307);
    expect(missing.headers().location).toContain("error=invalid_request");
  });

  test("registration refuses an unsafe redirect URI", async ({ request }) => {
    const res = await request.post("/api/oauth/register", {
      data: { client_name: "x", redirect_uris: ["javascript:alert(1)"] },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("invalid_client_metadata");
  });

  test("consent page: sign-in is required, then a person approves and lands on the client", async ({
    page,
    request,
    seeded,
  }) => {
    const clientId = await register(request);
    const { challenge } = pkcePair();
    const query = authorizeQuery(clientId, challenge);

    let landed = "";
    await page.route("http://localhost:8765/**", async (route) => {
      landed = route.request().url();
      await route.fulfill({ status: 200, body: "ok" });
    });

    await page.goto(`/app/oauth/consent?${query}`);
    // Not signed in: the page sends the visitor to /login and remembers where to come back to.
    await page.waitForURL(/\/login\?next=/);
    expect(decodeURIComponent(page.url())).toContain("/app/oauth/consent");

    await page
      .context()
      .addCookies([{ name: "session", value: seeded.sessionToken, url: page.url() }]);
    await page.goto(`/app/oauth/consent?${query}`);
    await expect(page.getByText("「E2E Claude」想要連線到你的揪帳")).toBeVisible();
    await expect(page.getByText("localhost:8765")).toBeVisible();
    await expect(page.getByRole("button", { name: "允許" })).toBeDisabled();
    await page.getByRole("checkbox", { name: new RegExp(seeded.groupTitle) }).click();
    await page.getByRole("button", { name: "允許" }).click();
    await expect.poll(() => landed).toContain("code=");
    expect(landed).toContain("state=st-1");
  });

  test("Mini App: the consent page only says it is not supported", async ({ page, seeded }) => {
    test.skip(!miniBotToken(), "E2E_TELEGRAM_BOT_TOKEN is not set");
    const { challenge } = pkcePair();
    await openMini(page, `/oauth/consent?client_id=x&code_challenge=${challenge}`, seeded);
    await expect(page.getByText(/Mini App 不支援/)).toBeVisible();
    await expect(page.getByRole("button", { name: "允許" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /用瀏覽器開啟/ })).toBeVisible();
  });
});
