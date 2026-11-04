import { describe, expect, it } from "vitest";

import { planUnlink } from "../unlink-plan";

describe("planUnlink", () => {
  it("lets a member detach a group that has a chat", () => {
    expect(planUnlink({ isMember: true, hasChat: true })).toEqual({ ok: true });
  });

  it("refuses a group with no chat, which is what a second simultaneous unlink sees", () => {
    expect(planUnlink({ isMember: true, hasChat: false })).toEqual({
      ok: false,
      reason: "no_chat",
    });
  });

  it("refuses a non-member before saying anything about the chat", () => {
    expect(planUnlink({ isMember: false, hasChat: false })).toEqual({
      ok: false,
      reason: "not_member",
    });
  });
});
