import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LinkedAppsPage } from "@/components/pages/LinkedAppsPage";
import { LinkedAppsSection } from "@/components/pages/LinkedAppsSection";
import { miniPlatform } from "@/components/pages/platform.mini";
import type { AppConnectionItem } from "@/lib/api-types";
import { fakeRequest, StoreWrapper } from "@/store/test-utils";

// Radix's Checkbox measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const platform = { ...miniPlatform, useBack: () => {} };

const ME = {
  userId: 1,
  groups: [
    { id: 1, title: "東京旅行", defaultCurrency: "JPY" },
    { id: 2, title: "室友", defaultCurrency: "TWD" },
  ],
  activeGroupId: null,
  activeExpenseId: null,
  activeSettlementId: null,
  activeInviteCode: null,
};

const conn = (over: Partial<AppConnectionItem>): AppConnectionItem => ({
  id: 5,
  kind: "token",
  name: "我的 n8n",
  tokenPrefix: "sbk_7Kq2",
  access: "read",
  allGroups: false,
  groupIds: [2],
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
});

function renderPage(connections: AppConnectionItem[], extra: Record<string, object> = {}) {
  const request = fakeRequest({
    "/api/me/app-connections": { connections },
    "/api/me/groups": ME,
    ...extra,
  });
  render(
    <StoreWrapper request={request}>
      <LinkedAppsPage platform={platform} />
    </StoreWrapper>,
  );
  return request;
}

const bodies = (request: ReturnType<typeof fakeRequest>, method: string) =>
  request.mock.calls
    .filter(([, init]) => init?.method === method)
    .map(([, init]) => JSON.parse(String(init?.body ?? "null")));

describe("LinkedAppsPage list", () => {
  it("shows each connection's permission and groups, and leaves revoked ones out", async () => {
    renderPage([
      conn({}),
      conn({ id: 6, name: "已撤銷的", revokedAt: "2026-10-05T00:00:00Z" }),
      conn({ id: 7, name: "Cursor", access: "write", allGroups: true, groupIds: [] }),
    ]);
    expect(await screen.findByText("我的 n8n")).toBeInTheDocument();
    expect(screen.getByText(/室友/)).toBeInTheDocument();
    expect(screen.getByText("唯讀")).toBeInTheDocument();
    expect(screen.getByText("可記帳")).toBeInTheDocument();
    expect(screen.getByText(/所有群組/)).toBeInTheDocument();
    expect(screen.queryByText("已撤銷的")).not.toBeInTheDocument();
  });
});

describe("建立個人存取權杖", () => {
  async function openCreate() {
    const request = renderPage([]);
    fireEvent.click(await screen.findByRole("button", { name: /建立個人存取權杖/ }));
    return request;
  }

  it("starts read-only with no group ticked, and can't be created until a group is chosen", async () => {
    await openCreate();
    expect(screen.getByRole("radio", { name: "唯讀" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: /所有群組/ })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("名稱"), { target: { value: "刷卡簡訊" } });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "建立" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /室友/ }));
    expect(within(dialog).getByRole("button", { name: "建立" })).toBeEnabled();
  });

  it("sends the narrow grant by default and shows the token only until 完成", async () => {
    const request = renderPage([], {});
    request.mockImplementation(async (path, init) => {
      if (path === "/api/me/app-connections" && init?.method === "POST") {
        return new Response(
          JSON.stringify({ connection: conn({ name: "刷卡簡訊" }), token: "sbk_SECRET123" }),
          { status: 201 },
        );
      }
      const body = path === "/api/me/groups" ? ME : { connections: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    fireEvent.click(await screen.findByRole("button", { name: /建立個人存取權杖/ }));
    fireEvent.change(screen.getByLabelText("名稱"), { target: { value: "刷卡簡訊" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /室友/ }));
    fireEvent.click(screen.getByRole("button", { name: "建立" }));

    expect(await screen.findByDisplayValue("sbk_SECRET123")).toBeInTheDocument();
    expect(bodies(request, "POST")[0]).toEqual({
      name: "刷卡簡訊",
      access: "read",
      allGroups: false,
      groupIds: [2],
      expiresInDays: 90,
    });

    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    await waitFor(() =>
      expect(screen.queryByDisplayValue("sbk_SECRET123")).not.toBeInTheDocument(),
    );
    // Opening it again starts a fresh form, not the old token.
    fireEvent.click(screen.getByRole("button", { name: /建立個人存取權杖/ }));
    expect(screen.queryByDisplayValue("sbk_SECRET123")).not.toBeInTheDocument();
    expect(screen.getByLabelText("名稱")).toHaveValue("");
  });

  it("falls back to a selectable read-only field when the clipboard refuses", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const request = renderPage([]);
    request.mockImplementation(async (path, init) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ connection: conn({}), token: "sbk_ABC" }), {
          status: 201,
        });
      }
      return new Response(JSON.stringify(path === "/api/me/groups" ? ME : { connections: [] }), {
        status: 200,
      });
    });
    fireEvent.click(await screen.findByRole("button", { name: /建立個人存取權杖/ }));
    fireEvent.change(screen.getByLabelText("名稱"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /室友/ }));
    fireEvent.click(screen.getByRole("button", { name: "建立" }));
    await screen.findByDisplayValue("sbk_ABC");
    fireEvent.click(screen.getByRole("button", { name: "複製權杖" }));
    expect(await screen.findByText(/無法自動複製/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("sbk_ABC")).toHaveAttribute("readonly");
  });
});

describe("a connection", () => {
  it("asks before revoking, and revokes only on confirm", async () => {
    const request = renderPage([conn({})], { "/api/me/app-connections/5": { ok: true } });
    fireEvent.click(await screen.findByText("我的 n8n"));
    fireEvent.click(screen.getByRole("button", { name: "撤銷這個連線" }));
    expect(await screen.findByText(/撤銷「我的 n8n」？/)).toBeInTheDocument();
    expect(bodies(request, "DELETE")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "撤銷" }));
    await waitFor(() => expect(bodies(request, "DELETE")).toHaveLength(1));
  });

  it("asks before widening to 可記帳 and saves a narrowing straight away", async () => {
    const request = renderPage([conn({})], { "/api/me/app-connections/5": { connection: {} } });
    fireEvent.click(await screen.findByText("我的 n8n"));
    const save = () => screen.getByRole("button", { name: "儲存變更" });
    expect(save()).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "可記帳" }));
    fireEvent.click(save());
    expect(await screen.findByText(/可以記帳？/)).toBeInTheDocument();
    expect(bodies(request, "PATCH")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "允許記帳" }));
    await waitFor(() => expect(bodies(request, "PATCH")).toEqual([{ access: "write" }]));
  });
});

describe("LinkedAppsSection on 個人設定", () => {
  it("shows the number of connections that work now", async () => {
    const request = fakeRequest({
      "/api/me/app-connections": {
        connections: [conn({}), conn({ id: 6, revokedAt: "2026-10-05T00:00:00Z" })],
      },
    });
    render(
      <StoreWrapper request={request}>
        <LinkedAppsSection platform={platform} />
      </StoreWrapper>,
    );
    expect(await screen.findByText("1")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/mini/settings/apps");
  });
});
