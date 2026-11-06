import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityList } from "@/components/mini/ActivityList";
import type { ActivityEntry } from "@/lib/record-history";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function entry(overrides: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: 1,
    action: "updated",
    at: "2026-10-28T04:00:00Z",
    actor: { userId: 1, displayName: null, firstName: "小明", lastName: null, username: null },
    via: null,
    recordId: 7,
    recordType: "expense",
    recordLabel: "晚餐",
    ...overrides,
  };
}

const props = { appBase: "/mini", groupId: 1 };

describe("ActivityList", () => {
  it("shows a changed field as its old value, then the new one", () => {
    const { container } = render(
      <ActivityList
        {...props}
        entries={[
          entry({
            changes: [{ key: "amount", label: "金額", before: "300", after: "800" }],
          }),
        ]}
      />,
    );

    expect(container).toHaveTextContent("金額 300→800");
  });

  it("links an ordinary row to its record's history", () => {
    render(<ActivityList {...props} entries={[entry({})]} />);

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/mini\/groups\/1\/activity\?record=7&from=/),
    );
  });

  it("links a deleted record too, since its history says who removed it", () => {
    render(
      <ActivityList {...props} entries={[entry({ action: "deleted", summary: "晚餐 $300" })]} />,
    );

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      expect.stringContaining("/mini/groups/1/activity?record=7"),
    );
  });

  it("makes the history's 返回 come back to this feed", () => {
    render(<ActivityList {...props} entries={[entry({})]} />);

    const href = screen.getByRole("link").getAttribute("href")!;
    expect(new URL(href, "http://x").searchParams.get("from")).toBe("/mini/groups/1/activity");
  });

  it.each<[string, Partial<ActivityEntry>, { linkRows?: boolean }]>([
    [
      "a rate lock belongs to the group, not to one row",
      {
        action: "rate_locked",
        rateLock: { base: "JPY", quote: "TWD", rate: 0.22, expenses: 3, settlements: 0 },
      },
      {},
    ],
    [
      "a join belongs to the group, not to one row",
      { action: "member_joined", recordId: null, recordType: "group" },
      {},
    ],
    [
      "an invite reset belongs to the group, not to one row",
      { action: "invite_reset", recordId: null, recordType: "group" },
      {},
    ],
    [
      "a chat link belongs to the group, not to one row",
      { action: "chat_linked", recordId: null, recordType: "group" },
      {},
    ],
    ["the record's own history page is already where you are", {}, { linkRows: false }],
  ])("does not link a row when %s", (_, overrides, listProps) => {
    render(<ActivityList {...props} entries={[entry(overrides)]} {...listProps} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says who invited a member who joined", () => {
    const { container } = render(
      <ActivityList
        {...props}
        entries={[
          entry({
            action: "member_joined",
            recordId: null,
            recordType: "group",
            groupEvent: { inviterName: "阿華" },
          }),
        ]}
      />,
    );

    expect(container).toHaveTextContent("小明 加入了群組（由 阿華 邀請）");
  });

  it("describes an invite reset", () => {
    const { container } = render(
      <ActivityList
        {...props}
        entries={[entry({ action: "invite_reset", recordId: null, recordType: "group" })]}
      />,
    );

    expect(container).toHaveTextContent("小明 重設了邀請碼");
  });

  it("describes a claimed placeholder and how many records moved", () => {
    const { container } = render(
      <ActivityList
        {...props}
        entries={[
          entry({
            action: "member_claimed",
            recordId: null,
            recordType: "group",
            groupEvent: { claimedName: "小明", claimedCount: 12 },
          }),
        ]}
      />,
    );

    expect(container).toHaveTextContent("小明 認領了 小明");
    expect(container).toHaveTextContent("12 筆紀錄改記在他名下");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("names the chat a group was bound to", () => {
    const { container } = render(
      <ActivityList
        {...props}
        entries={[
          entry({
            action: "chat_linked",
            recordId: null,
            recordType: "group",
            groupEvent: { chatTitle: "日本行" },
          }),
        ]}
      />,
    );

    expect(container).toHaveTextContent("小明 綁定了 Telegram 群組（日本行）");
  });

  it("says which chat a group was detached from", () => {
    const { container } = render(
      <ActivityList
        {...props}
        entries={[
          entry({
            action: "chat_unlinked",
            recordId: null,
            recordType: "group",
            groupEvent: { chatTitle: "日本行" },
          }),
        ]}
      />,
    );

    expect(container).toHaveTextContent("小明 解除了與 Telegram 群組「日本行」的綁定");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("groups rows under a heading per day", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 28, 12));

    const { container } = render(
      <ActivityList
        {...props}
        groupByDay
        showRecordLabel
        entries={[
          entry({
            id: 1,
            action: "created",
            recordLabel: "晚餐",
            at: new Date(2026, 9, 28, 9).toISOString(),
          }),
          entry({
            id: 2,
            action: "created",
            recordId: 8,
            recordLabel: "午餐",
            at: new Date(2026, 9, 27, 20).toISOString(),
          }),
        ]}
      />,
    );

    // Reading order is what the user sees: each day's heading comes before its
    // rows, and the 午餐 row sits under 昨天, not under 今天.
    expect(container.textContent).toMatch(/今天[\s\S]*新增了 晚餐[\s\S]*昨天[\s\S]*新增了 午餐/);
  });
});
