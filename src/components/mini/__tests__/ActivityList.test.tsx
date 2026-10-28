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
    actor: { userId: 1, firstName: "小明", lastName: null, username: null },
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

    expect(screen.getByRole("link")).toHaveAttribute("href", "/mini/groups/1/activity?record=7");
  });

  it.each<[string, Partial<ActivityEntry>, { linkRows?: boolean }]>([
    ["a deleted record has nowhere to go", { action: "deleted", summary: "晚餐 $300" }, {}],
    [
      "a rate lock belongs to the group, not to one row",
      {
        action: "rate_locked",
        rateLock: { base: "JPY", quote: "TWD", rate: 0.22, expenses: 3, settlements: 0 },
      },
      {},
    ],
    ["the record's own history page is already where you are", {}, { linkRows: false }],
  ])("does not link a row when %s", (_, overrides, listProps) => {
    render(<ActivityList {...props} entries={[entry(overrides)]} {...listProps} />);

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
