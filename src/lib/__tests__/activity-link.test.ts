import { describe, expect, it } from "vitest";

import { parseHistoryFrom, recordHistoryHref } from "@/lib/activity-link";

const scope = { appBase: "/app", groupId: 86 };

function fromOf(href: string): string | null {
  return parseHistoryFrom(new URL(href, "http://x").searchParams.get("from"), scope);
}

describe("record history link", () => {
  it("round-trips the page it was opened from", () => {
    const href = recordHistoryHref({
      ...scope,
      recordId: 70,
      from: "/app/groups/86/expenses/70/edit",
    });

    expect(href.startsWith("/app/groups/86/activity?record=70&from=")).toBe(true);
    expect(fromOf(href)).toBe("/app/groups/86/expenses/70/edit");
  });

  it("round-trips the activity feed", () => {
    const href = recordHistoryHref({ ...scope, recordId: 70, from: "/app/groups/86/activity" });

    expect(fromOf(href)).toBe("/app/groups/86/activity");
  });

  it("has no from when none is given", () => {
    const href = recordHistoryHref({ ...scope, recordId: 70 });

    expect(href).toBe("/app/groups/86/activity?record=70");
    expect(fromOf(href)).toBeNull();
  });

  it.each([
    ["another site", "https://evil.test/app/groups/86/x"],
    ["a protocol-relative url", "//evil.test"],
    ["another group", "/app/groups/87/expenses/1/edit"],
    ["the other front end", "/mini/groups/86/expenses/1/edit"],
    ["the group prefix with nothing after it", "/app/groups/86/"],
    ["a dot-dot segment", "/app/groups/86/../87/expenses"],
    ["a backslash", "/app/groups/86/\\evil.test"],
    ["a double slash", "/app/groups/86//evil.test"],
    ["whitespace", "/app/groups/86/ x"],
    ["an encoded dot-dot segment", "/app/groups/86/%2e%2E/87/expenses"],
    ["an encoded slash", "/app/groups/86/..%2f87"],
  ])("ignores %s", (_, raw) => {
    expect(parseHistoryFrom(raw, scope)).toBeNull();
  });

  it("does not build a link with an invalid from", () => {
    expect(recordHistoryHref({ ...scope, recordId: 70, from: "https://evil.test" })).toBe(
      "/app/groups/86/activity?record=70",
    );
  });
});
