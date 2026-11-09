import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GROUP_ONLY } from "@/lib/buttons";
import { COMMON_TIME_ZONES } from "@/lib/timezone";

import { parseTimezoneCallback, timezoneCallback, timezoneCommand } from "../commands/timezone";
import { dbGroup, expectAllCallsStubbed, testBot } from "./harness";

const { changeGroupTimezone } = vi.hoisted(() => ({ changeGroupTimezone: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/group-timezone", () => ({ changeGroupTimezone }));

beforeEach(() => changeGroupTimezone.mockReset());
afterEach(() => expectAllCallsStubbed());

function stubReplies(t: ReturnType<typeof testBot>) {
  t.answer("answerCallbackQuery", () => true);
  t.answer("editMessageText", () => true);
}

describe("timezone callback data", () => {
  it("round-trips for every button the command offers", () => {
    for (const z of COMMON_TIME_ZONES) {
      expect(parseTimezoneCallback(timezoneCallback(7, z.tz))).toEqual({
        groupId: 7,
        timeZone: z.tz,
      });
    }
  });

  it("refuses a name that is not a zone", () => {
    expect(parseTimezoneCallback("tz:7:Not/AZone")).toBeNull();
    expect(parseTimezoneCallback("tz:x:Asia/Tokyo")).toBeNull();
    expect(parseTimezoneCallback("tz:7:")).toBeNull();
  });
});

describe("/timezone", () => {
  it("shows the current zone, what it is for, and the common zones as buttons", async () => {
    const t = testBot(timezoneCommand, {
      user: undefined,
      group: dbGroup({ timezone: "Asia/Tokyo" }),
    });
    await t.send("/timezone");

    const [msg] = t.callsOf("sendMessage");
    expect(String(msg.text)).toContain("Asia/Tokyo (UTC+9)");
    expect(String(msg.text)).toContain("/add");
    const keyboard = JSON.stringify(msg.reply_markup);
    expect(keyboard).toContain("✓ Asia/Tokyo (UTC+9)");
    expect(keyboard).toContain(timezoneCallback(7, "Asia/Taipei"));
    expect(keyboard).toContain(timezoneCallback(7, "America/Los_Angeles"));
  });

  it("explains itself outside a group", async () => {
    const t = testBot(timezoneCommand, { user: undefined, group: undefined });
    await t.send("/timezone");
    expect(t.replies()).toEqual([GROUP_ONLY]);
  });
});

describe("a zone button", () => {
  it("changes the zone and says who did", async () => {
    changeGroupTimezone.mockResolvedValue({
      ok: true,
      from: "Asia/Taipei",
      to: "Asia/Tokyo",
      changed: true,
    });
    const t = testBot(timezoneCommand);
    stubReplies(t);
    await t.press(timezoneCallback(7, "Asia/Tokyo"));

    expect(changeGroupTimezone).toHaveBeenCalledWith(
      7,
      "Asia/Tokyo",
      expect.objectContaining({ source: "bot" }),
    );
    const [edit] = t.callsOf("editMessageText");
    expect(String(edit.text)).toContain("Alice 改成了 Asia/Tokyo");
    expect(JSON.stringify(edit.reply_markup)).toContain("✓ Asia/Tokyo (UTC+9)");
  });

  it("leaves the message alone when the zone is already that one", async () => {
    changeGroupTimezone.mockResolvedValue({
      ok: true,
      from: "Asia/Taipei",
      to: "Asia/Taipei",
      changed: false,
    });
    const t = testBot(timezoneCommand);
    stubReplies(t);
    await t.press(timezoneCallback(7, "Asia/Taipei"));
    expect(t.callsOf("editMessageText")).toEqual([]);
  });

  it("refuses a button that names another group", async () => {
    const t = testBot(timezoneCommand);
    stubReplies(t);
    await t.press(timezoneCallback(99, "Asia/Tokyo"));
    expect(changeGroupTimezone).not.toHaveBeenCalled();
  });

  it("refuses a zone that is not one", async () => {
    const t = testBot(timezoneCommand);
    stubReplies(t);
    await t.press("tz:7:Not/AZone");
    expect(changeGroupTimezone).not.toHaveBeenCalled();
  });
});
