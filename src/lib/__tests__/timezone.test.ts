import { describe, expect, it } from "vitest";

import {
  COMMON_TIME_ZONES,
  DEFAULT_TIME_ZONE,
  describeTimeZone,
  formatUtcOffset,
  isValidTimeZone,
  sameOffset,
  shouldPromptTimezone,
  timeZoneOrDefault,
  timezonePromptKey,
  utcOffsetMinutes,
} from "../timezone";

describe("isValidTimeZone", () => {
  it("accepts IANA names the runtime knows", () => {
    for (const tz of ["Asia/Taipei", "Asia/Tokyo", "America/Los_Angeles", "UTC"]) {
      expect(isValidTimeZone(tz)).toBe(true);
    }
  });

  it("refuses anything else, including things Intl would accept as an offset", () => {
    for (const tz of ["", "Taipei", "UTC+8", "+08:00", "asia/taipei", "Asia/Nowhere", null, 8]) {
      expect(isValidTimeZone(tz)).toBe(false);
    }
  });

  it("knows every zone the bot offers as a button", () => {
    for (const z of COMMON_TIME_ZONES) expect(isValidTimeZone(z.tz)).toBe(true);
    // The callback data must stay inside Telegram's 64-byte limit.
    for (const z of COMMON_TIME_ZONES) {
      expect(new TextEncoder().encode(`tz:2147483647:${z.tz}`).length).toBeLessThanOrEqual(64);
    }
  });
});

describe("timeZoneOrDefault", () => {
  it("falls back for a zone we can't store", () => {
    expect(timeZoneOrDefault("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(timeZoneOrDefault("Not/AZone")).toBe(DEFAULT_TIME_ZONE);
    expect(timeZoneOrDefault(undefined)).toBe(DEFAULT_TIME_ZONE);
  });
});

describe("utcOffsetMinutes", () => {
  it("is minutes east of UTC", () => {
    const at = new Date("2026-01-15T00:00:00Z");
    expect(utcOffsetMinutes("Asia/Taipei", at)).toBe(480);
    expect(utcOffsetMinutes("Asia/Tokyo", at)).toBe(540);
    expect(utcOffsetMinutes("Asia/Kolkata", at)).toBe(330);
    expect(utcOffsetMinutes("UTC", at)).toBe(0);
  });

  it("follows daylight saving at the given instant", () => {
    expect(utcOffsetMinutes("America/Los_Angeles", new Date("2026-01-15T12:00:00Z"))).toBe(-480);
    expect(utcOffsetMinutes("America/Los_Angeles", new Date("2026-07-15T12:00:00Z"))).toBe(-420);
  });
});

describe("formatUtcOffset", () => {
  it("writes whole hours without minutes and keeps half hours", () => {
    expect(formatUtcOffset(480)).toBe("UTC+8");
    expect(formatUtcOffset(-420)).toBe("UTC-7");
    expect(formatUtcOffset(330)).toBe("UTC+5:30");
    expect(formatUtcOffset(0)).toBe("UTC");
  });

  it("describes a zone with its current offset", () => {
    expect(describeTimeZone("Asia/Tokyo", new Date("2026-01-15T00:00:00Z"))).toBe(
      "Asia/Tokyo (UTC+9)",
    );
  });
});

describe("shouldPromptTimezone", () => {
  const at = new Date("2026-01-15T00:00:00Z");
  const ask = (deviceTimeZone: string | null, groupTimeZone: string, dismissed = false) =>
    shouldPromptTimezone({ deviceTimeZone, groupTimeZone, dismissed, at });

  it("asks when the UTC offsets differ", () => {
    expect(ask("Asia/Tokyo", "Asia/Taipei")).toBe(true);
  });

  it("does not ask for a different zone at the same offset", () => {
    expect(sameOffset("Asia/Singapore", "Asia/Taipei", at)).toBe(true);
    expect(ask("Asia/Singapore", "Asia/Taipei")).toBe(false);
    expect(ask("Asia/Taipei", "Asia/Taipei")).toBe(false);
  });

  it("compares offsets now: two zones can differ in winter and agree in summer", () => {
    const summer = new Date("2026-07-15T12:00:00Z");
    expect(
      shouldPromptTimezone({
        deviceTimeZone: "America/Los_Angeles",
        groupTimeZone: "America/Phoenix",
        dismissed: false,
        at,
      }),
    ).toBe(true);
    expect(
      shouldPromptTimezone({
        deviceTimeZone: "America/Los_Angeles",
        groupTimeZone: "America/Phoenix",
        dismissed: false,
        at: summer,
      }),
    ).toBe(false);
  });

  it("stays quiet once this device said 不用", () => {
    expect(ask("Asia/Tokyo", "Asia/Taipei", true)).toBe(false);
  });

  it("never offers a zone it could not store", () => {
    expect(ask("Not/AZone", "Asia/Taipei")).toBe(false);
    expect(ask(null, "Asia/Taipei")).toBe(false);
  });

  it("remembers a refusal per group and per device zone", () => {
    expect(timezonePromptKey(7, "Asia/Tokyo")).not.toBe(timezonePromptKey(8, "Asia/Tokyo"));
    // Travelling on to another zone asks again, because the key changed.
    expect(timezonePromptKey(7, "Asia/Tokyo")).not.toBe(timezonePromptKey(7, "Asia/Seoul"));
  });
});
