import { describe, expect, it } from "vitest";

import {
  addDays,
  dayInZone,
  dayToLocalDate,
  isDay,
  localDateToDay,
  snapshotDay,
  todayIn,
} from "../day";

describe("isDay", () => {
  it("accepts real calendar days only", () => {
    expect(isDay("2026-02-28")).toBe(true);
    expect(isDay("2028-02-29")).toBe(true);
    for (const s of [
      "2026-02-29",
      "2026-02-31",
      "2026-13-01",
      "2026-1-1",
      "2026-03-04T00:00:00Z",
      "",
    ]) {
      expect(isDay(s)).toBe(false);
    }
    expect(isDay(20260304)).toBe(false);
  });
});

describe("dayInZone / todayIn", () => {
  it("is the calendar day in the zone, not in UTC", () => {
    const at = new Date("2026-02-28T16:30:00Z");
    expect(dayInZone(at, "Asia/Taipei")).toBe("2026-03-01");
    expect(dayInZone(at, "UTC")).toBe("2026-02-28");
    expect(dayInZone(at, "America/Los_Angeles")).toBe("2026-02-28");
    expect(todayIn("Asia/Tokyo", at)).toBe("2026-03-01");
  });
});

describe("local days", () => {
  it("reads a day as the local calendar date, not UTC midnight", () => {
    const d = dayToLocalDate("2026-01-15");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 0, 15, 0]);
  });

  it("round-trips a picker date through a day string", () => {
    expect(localDateToDay(dayToLocalDate("2026-01-05"))).toBe("2026-01-05");
    // The picker's local midnight is the day it shows, in whatever zone the device is in.
    expect(localDateToDay(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });
});

describe("addDays", () => {
  it("does calendar arithmetic across month and year ends", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("snapshotDay", () => {
  it("passes a day through, and hands back what is not a date", () => {
    expect(snapshotDay("2026-07-25")).toBe("2026-07-25");
    expect(snapshotDay("garbage")).toBe("garbage");
  });

  it("reads an old audit instant as its day in the default zone", () => {
    // The forms stored UTC noon: the same day everywhere.
    expect(snapshotDay("2026-07-25T12:00:00.000Z")).toBe("2026-07-25");
    // An old bot record kept its real time; 17:00 UTC is already the next day in Taipei, the
    // day the rate lookup always used for it.
    expect(snapshotDay("2026-07-24T17:00:00.000Z")).toBe("2026-07-25");
  });
});
