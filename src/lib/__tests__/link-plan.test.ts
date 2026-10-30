import { describe, expect, it } from "vitest";

import { planLink } from "../link-plan";

const base = {
  codeValid: true,
  senderIsMember: true,
  targetHasChat: false,
  chatGroup: { hasRecords: false, wasLinked: false },
};

describe("planLink", () => {
  it("folds in the chat's auto-created group when it holds no expenses", () => {
    expect(planLink(base)).toEqual({ ok: true, absorb: true });
  });

  it("has nothing to fold when the chat has no group row of its own", () => {
    expect(planLink({ ...base, chatGroup: null })).toEqual({ ok: true, absorb: false });
  });

  it("answers a bad code and a non-member identically", () => {
    const badCode = planLink({ ...base, codeValid: false });
    const stranger = planLink({ ...base, senderIsMember: false });
    expect(badCode).toEqual({ ok: false, reason: "not_found" });
    expect(stranger).toEqual(badCode);
  });

  it("does not reveal that a group is already linked to a non-member", () => {
    expect(planLink({ ...base, senderIsMember: false, targetHasChat: true })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses a group that already has a chat", () => {
    expect(planLink({ ...base, targetHasChat: true })).toEqual({
      ok: false,
      reason: "already_linked",
    });
  });

  it("refuses when the chat already has its own expenses", () => {
    expect(planLink({ ...base, chatGroup: { hasRecords: true, wasLinked: false } })).toEqual({
      ok: false,
      reason: "both_have_records",
    });
  });

  it("refuses a chat that an earlier /link already bound, even with no expenses", () => {
    expect(planLink({ ...base, chatGroup: { hasRecords: false, wasLinked: true } })).toEqual({
      ok: false,
      reason: "chat_already_linked",
    });
  });
});
