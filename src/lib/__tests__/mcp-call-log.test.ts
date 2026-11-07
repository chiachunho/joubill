import { describe, expect, it } from "vitest";

import {
  callGroupId,
  callOutcome,
  callRecordId,
  linksToRecord,
  outcomeInfo,
  parseCallCursor,
  parseCallFilter,
  SUCCESS_OUTCOMES,
  WRITE_TOOLS,
} from "@/lib/mcp-call-log";
import type { ToolErrorCode } from "@/lib/mcp/result";

describe("callOutcome", () => {
  it("uses the error code of a failed call", () => {
    expect(
      callOutcome({ isError: true, structuredContent: { error: { code: "forbidden" } } }),
    ).toBe("forbidden");
    expect(callOutcome({ isError: true })).toBe("internal");
  });

  it("names a preview or a repeat, and calls everything else ok", () => {
    expect(callOutcome({ structuredContent: { status: "preview" } })).toBe("preview");
    expect(callOutcome({ structuredContent: { status: "duplicate" } })).toBe("duplicate");
    expect(callOutcome({ structuredContent: { status: "possible_duplicate" } })).toBe(
      "possible_duplicate",
    );
    expect(callOutcome({ structuredContent: { status: "created" } })).toBe("ok");
    expect(callOutcome({ structuredContent: { groups: [] } })).toBe("ok");
  });

  it("never lets free text into the outcome", () => {
    const out = callOutcome({
      isError: true,
      structuredContent: { error: { code: "x".repeat(100) } },
    });
    expect(out.length).toBeLessThanOrEqual(24);
  });
});

describe("what is logged", () => {
  it("takes ids from the arguments and the result, nothing else", () => {
    expect(callGroupId({ groupId: 12, description: "secret" })).toBe(12);
    expect(callGroupId({ groupId: "12" })).toBeNull();
    expect(callGroupId({ groupId: 2 ** 40 })).toBeNull();
    expect(callRecordId({ recordId: 5 }, { structuredContent: { recordId: 9 } })).toBe(9);
    expect(callRecordId({ recordId: 5 }, {})).toBe(5);
    expect(callRecordId(null, {})).toBeNull();
  });
});

describe("outcomes and filters", () => {
  it("has a label for every tool error code, so none shows as a bare 失敗", () => {
    const codes: ToolErrorCode[] = [
      "bad_request",
      "forbidden",
      "not_found",
      "rate_limited",
      "member_not_found",
      "member_ambiguous",
      "in_progress",
      "conflict",
      "internal",
    ];
    for (const c of codes) expect(outcomeInfo(c).label).not.toBe("失敗");
    for (const o of SUCCESS_OUTCOMES) expect(outcomeInfo(o).tone).not.toBe("bad");
    expect(outcomeInfo("something_new").tone).toBe("bad");
  });

  it("links to a record only after a write that went through", () => {
    expect(linksToRecord("add_expense", "ok")).toBe(true);
    expect(linksToRecord("attach_receipt", "ok")).toBe(true);
    expect(linksToRecord("add_expense", "preview")).toBe(false);
    expect(linksToRecord("add_expense", "forbidden")).toBe(false);
    expect(linksToRecord("get_record", "ok")).toBe(false);
    expect(WRITE_TOOLS).toContain("attach_receipt");
  });

  it("parses the filter and the cursor strictly", () => {
    expect(parseCallFilter("failed")).toBe("failed");
    expect(parseCallFilter("nope")).toBeNull();
    expect(parseCallFilter(null)).toBeNull();
    expect(parseCallCursor("42")).toBe(42);
    for (const bad of ["", "0", "-1", "1.5", "abc", "2147483648", "99999999999"]) {
      expect(parseCallCursor(bad)).toBeNull();
    }
  });
});
