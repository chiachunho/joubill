import { describe, expect, it } from "vitest";

import { splitReceiptText } from "@/lib/mcp/prompts";

describe("splitReceiptText", () => {
  it("tells the agent the rules that fail silently", () => {
    const t = splitReceiptText({});
    expect(t).toContain("one at a time");
    expect(t).toContain("running total");
    expect(t).toContain("'exact'");
    expect(t).toContain("dryRun: true");
    expect(t).toContain("largest amount");
    expect(t).toContain("attach_receipt");
  });

  it("carries the group and payer when given", () => {
    const t = splitReceiptText({ groupId: "12", payer: "阿華" });
    expect(t).toContain("group is 12");
    expect(t).toContain("阿華 paid the whole bill");
  });
});
