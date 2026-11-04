import { describe, expect, it } from "vitest";

import { planUnlink } from "../unlink-plan";

describe("planUnlink", () => {
  it("lets a group that has a chat be detached", () => {
    expect(planUnlink({ hasChat: true })).toEqual({ ok: true });
  });

  it("refuses a group with no chat, which is what a second simultaneous unlink sees", () => {
    expect(planUnlink({ hasChat: false })).toEqual({ ok: false, reason: "no_chat" });
  });
});
