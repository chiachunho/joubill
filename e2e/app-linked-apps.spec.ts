import { call, mkToken, rpc } from "./mcp";
import { expect, test } from "./fixtures";
import { addExpense } from "./helpers";

// 個人設定 → 連結的應用程式 (issue #150): the settings page, and where a record that came in
// through the MCP server says so. The MCP calls themselves are covered in mcp.spec.ts.
test.describe("連結的應用程式", () => {
  test("creates a personal access token that works, then revokes it", async ({
    authedPage,
    request,
    seeded,
  }) => {
    await authedPage.goto("/app/settings/apps");
    await authedPage.getByRole("button", { name: /建立個人存取權杖/ }).click();

    // The narrow defaults: read-only, nothing ticked, so 建立 waits for a group.
    await expect(authedPage.getByRole("radio", { name: "唯讀" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await authedPage.getByLabel("名稱").fill("E2E 刷卡簡訊");
    const dialog = authedPage.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "建立" })).toBeDisabled();
    await dialog.getByRole("checkbox", { name: new RegExp(seeded.groupTitle) }).click();
    await dialog.getByRole("button", { name: "建立" }).click();

    const token = await authedPage.getByLabel("權杖", { exact: true }).inputValue();
    expect(token).toMatch(/^sbk_/);
    await authedPage.getByRole("button", { name: "完成" }).click();

    // No cookie on `request`: only the bearer token authenticates.
    expect((await rpc(request, token, "tools/list")).status()).toBe(200);

    // The token is not shown again; the row is, and it is read-only.
    await expect(authedPage.getByText(token)).toHaveCount(0);
    await authedPage.getByRole("button", { name: /E2E 刷卡簡訊/ }).click();
    await expect(authedPage.getByRole("radio", { name: "唯讀" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await authedPage.getByRole("button", { name: "撤銷這個連線" }).click();
    await authedPage.getByRole("button", { name: "撤銷", exact: true }).click();
    await expect(authedPage.getByText("E2E 刷卡簡訊")).toHaveCount(0);

    expect((await rpc(request, token, "tools/list")).status()).toBe(401);
  });

  test("a record entered through an application says so in the form and the feed", async ({
    authedPage,
    request,
    seeded,
    dbPool,
  }) => {
    const { token } = await mkToken(dbPool, seeded.userId, {
      name: "E2E 應用程式",
      groupIds: [seeded.groupId],
    });
    const created = await call(request, token, "add_expense", {
      groupId: seeded.groupId,
      amount: 480,
      description: "E2E via MCP dinner",
      split: { type: "equal", among: [seeded.partnerName, "me"] },
      idempotencyKey: `e2e-linked-${seeded.groupId}`,
    });
    expect(created.structuredContent).toMatchObject({ status: "created" });
    const recordId = created.structuredContent!.recordId as number;

    // A person's own record in the same group, to tell the two filters apart.
    await addExpense(authedPage.request, seeded.groupId, {
      amount: 100,
      shareType: "equal",
      payers: [{ payerId: seeded.userId, amount: 100 }],
      splits: [
        { debtorId: seeded.userId, amount: 50 },
        { debtorId: seeded.partnerId, amount: 50 },
      ],
    });

    await authedPage.goto(`/app/groups/${seeded.groupId}/expenses/${recordId}/edit`);
    await expect(authedPage.getByText(/由 .* 透過 E2E 應用程式 .*記錄/)).toBeVisible();

    await authedPage.goto(`/app/groups/${seeded.groupId}/activity`);
    await expect(authedPage.getByText(/透過 E2E 應用程式/).first()).toBeVisible();
    await expect(authedPage.getByRole("img", { name: "透過 E2E 應用程式" })).toBeVisible();

    await authedPage.getByRole("radio", { name: "手動記錄" }).click();
    await expect(authedPage.getByText(/E2E merge equal/).first()).toBeVisible();
    await expect(authedPage.getByText(/E2E via MCP dinner/)).toHaveCount(0);

    await authedPage.getByRole("radio", { name: "透過應用程式" }).click();
    await expect(authedPage.getByText(/E2E via MCP dinner/)).toBeVisible();
    await expect(authedPage.getByText(/E2E merge equal/)).toHaveCount(0);
  });

  test("使用紀錄 lists a connection's calls and filters the failures", async ({
    authedPage,
    request,
    seeded,
    dbPool,
  }) => {
    const { token, id } = await mkToken(dbPool, seeded.userId, {
      name: "E2E 使用紀錄",
      groupIds: [seeded.groupId],
    });
    await call(request, token, "get_balance", { groupId: seeded.groupId });
    await call(request, token, "add_expense", {
      groupId: seeded.groupId,
      amount: "10",
      split: { type: "equal", among: ["nobody-by-this-name"] },
    });
    await expect
      .poll(
        async () =>
          (await dbPool.query("SELECT 1 FROM mcp_call_log WHERE connection_id=$1", [id])).rowCount,
      )
      .toBe(2);

    await authedPage.goto("/app/settings/apps");
    await authedPage.getByRole("button", { name: /E2E 使用紀錄/ }).click();
    await authedPage.getByRole("link", { name: /使用紀錄/ }).click();

    await expect(authedPage.getByText("get_balance")).toBeVisible();
    await expect(authedPage.getByText("找不到成員")).toBeVisible();

    await authedPage.getByRole("radio", { name: "失敗" }).click();
    await expect(authedPage.getByText("get_balance")).toHaveCount(0);
    await expect(authedPage.getByText("找不到成員")).toBeVisible();

    // Someone else's connection id is not found, not empty.
    const res = await authedPage.request.get(`/api/me/mcp-connections/${id + 1_000_000}/calls`);
    expect(res.status()).toBe(404);
  });
});
