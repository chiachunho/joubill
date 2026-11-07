import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { McpConnectionCallsPage } from "@/components/pages/McpConnectionCallsPage";
import type { Platform } from "@/components/pages/platform";
import { fakeRequest, StoreWrapper } from "@/store/test-utils";

afterEach(cleanup);

const platform = {
  basePath: "/app",
  loginPath: "/login",
  useBack: () => {},
  BackLink: ({ href }: { href: string }) => <a href={href}>返回</a>,
} as unknown as Platform;

const call = (over: object) => ({
  id: 1,
  tool: "add_expense",
  groupId: 7,
  outcome: "ok",
  recordId: 41,
  durationMs: 1800,
  createdAt: "2026-11-02T13:14:00Z",
  ...over,
});

function renderPage(calls: object[]) {
  const params = Object.assign(Promise.resolve({ id: "3" }), {
    status: "fulfilled" as const,
    value: { id: "3" },
  });
  const request = fakeRequest({
    "/api/me/mcp-connections/3/calls": { calls, nextCursor: null },
    "/api/me/mcp-connections": {
      connections: [{ id: 3, name: "Claude" }],
    },
    "/api/me/groups": { userId: 1, groups: [{ id: 7, title: "東京旅行" }] },
  });
  render(
    <StoreWrapper request={request}>
      <McpConnectionCallsPage params={params} platform={platform} />
    </StoreWrapper>,
  );
}

describe("McpConnectionCallsPage", () => {
  it("shows each call with its outcome and the group's name", async () => {
    renderPage([
      call({ id: 3, tool: "get_balance", outcome: "ok", recordId: null }),
      call({ id: 2, tool: "add_expense", outcome: "member_not_found", recordId: null }),
      call({ id: 1, tool: "add_expense", outcome: "preview", recordId: null }),
    ]);
    expect(await screen.findByText("get_balance")).toBeInTheDocument();
    expect(screen.getByText("找不到成員")).toBeInTheDocument();
    expect(screen.getByText("預覽")).toBeInTheDocument();
    expect(screen.getAllByText("東京旅行")).toHaveLength(3);
  });

  it("links to the record only for a write that succeeded, in a group the viewer is in", async () => {
    renderPage([
      call({ id: 3, tool: "add_expense", outcome: "ok", recordId: 41, groupId: 7 }),
      call({ id: 2, tool: "add_expense", outcome: "ok", recordId: 42, groupId: 99 }),
      call({ id: 1, tool: "get_record", outcome: "ok", recordId: 43, groupId: 7 }),
    ]);
    // The group names arrive separately; links are only built once they are known.
    await screen.findAllByText("東京旅行");
    const rows = screen.getAllByRole("button", { expanded: false });

    // One row is open at a time.
    fireEvent.click(rows[0]);
    const link = screen.getByRole("link", { name: /查看這筆紀錄/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("record=41"));

    fireEvent.click(rows[1]); // a group the viewer is not in
    expect(screen.queryByRole("link", { name: /查看這筆紀錄/ })).toBeNull();
    fireEvent.click(rows[2]); // a read
    expect(screen.queryByRole("link", { name: /查看這筆紀錄/ })).toBeNull();
    expect(screen.getByText("其他群組")).toBeInTheDocument();
  });

  it("says so when there is nothing yet", async () => {
    renderPage([]);
    expect(await screen.findByText("還沒有使用紀錄")).toBeInTheDocument();
  });
});
