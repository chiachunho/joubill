/**
 * Group time zones. Pure and free of server-only imports: the settings page, the
 * create form, the API and the bot all validate and describe a zone through here.
 *
 * A group's zone has exactly two jobs (see issue #144): deciding which calendar day
 * "now" is (so `/add` records today, and the market rate is looked up for today), and
 * nothing else. A record's own day is a plain `YYYY-MM-DD` and is never reinterpreted.
 */

/** The zone a new group starts with, and the fallback for anything unrecognised. */
export const DEFAULT_TIME_ZONE = "Asia/Taipei";

let supported: Set<string> | null = null;

function supportedSet(): Set<string> {
  if (!supported) {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    supported = new Set(intl.supportedValuesOf?.("timeZone") ?? [DEFAULT_TIME_ZONE]);
    // Some engines leave the zero zone out of the list although they accept it.
    supported.add("UTC");
  }
  return supported;
}

/** Every IANA zone name this runtime knows, sorted. */
export function supportedTimeZones(): string[] {
  return Array.from(supportedSet()).sort();
}

/** Whether `tz` is an IANA name from `Intl.supportedValuesOf("timeZone")`; anything else is refused. */
export function isValidTimeZone(tz: unknown): tz is string {
  return typeof tz === "string" && supportedSet().has(tz);
}

/** `tz` when valid, otherwise the default. For a zone read from a device, which we don't control. */
export function timeZoneOrDefault(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
}

const partsFormats = new Map<string, Intl.DateTimeFormat>();

function partsFormat(tz: string): Intl.DateTimeFormat {
  let f = partsFormats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    partsFormats.set(tz, f);
  }
  return f;
}

/** Minutes east of UTC that `tz` is at `at` (daylight saving included). */
export function utcOffsetMinutes(tz: string, at: Date = new Date()): number {
  const p: Record<string, number> = {};
  for (const part of partsFormat(tz).formatToParts(at)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const real = Math.floor(at.getTime() / 1000) * 1000;
  return Math.round((wall - real) / 60_000);
}

/** `UTC+8`, `UTC-3`, `UTC+5:30`, `UTC`. */
export function formatUtcOffset(minutes: number): string {
  if (minutes === 0) return "UTC";
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** `Asia/Tokyo (UTC+9)` — the zone's current offset, which is what a person compares. */
export function describeTimeZone(tz: string, at: Date = new Date()): string {
  return `${tz} (${formatUtcOffset(utcOffsetMinutes(tz, at))})`;
}

/** The zones the bot's `/timezone` offers as buttons, and the settings select lists first. */
export const COMMON_TIME_ZONES: readonly { tz: string; label: string }[] = [
  { tz: "Asia/Taipei", label: "台北" },
  { tz: "Asia/Tokyo", label: "東京" },
  { tz: "Asia/Seoul", label: "首爾" },
  { tz: "Asia/Bangkok", label: "曼谷" },
  { tz: "Asia/Singapore", label: "新加坡" },
  { tz: "America/Los_Angeles", label: "洛杉磯" },
];

/** Button label for a zone: the common city's name, otherwise the IANA name. */
export function timeZoneLabel(tz: string): string {
  return COMMON_TIME_ZONES.find((z) => z.tz === tz)?.label ?? tz;
}

/** Whether the device and the group are on the same clock right now (same UTC offset). */
export function sameOffset(a: string, b: string, at: Date = new Date()): boolean {
  return utcOffsetMinutes(a, at) === utcOffsetMinutes(b, at);
}

/**
 * What a group's time zone is for, worded once for the settings page, the create form and
 * the bot. Two jobs only; it never moves a record that already has a date.
 */
export const TIMEZONE_PURPOSE =
  "用途：① 決定一筆紀錄算哪一天、查哪一天的匯率；② bot 的 /add 沒指定日期時，記在這個時區的今天。不會改變已經選好日期的紀錄。";

/** The localStorage key remembering that this device said 不用 for this group at this device zone. */
export function timezonePromptKey(groupId: number | string, deviceTimeZone: string): string {
  return `tz-prompt-dismissed:${groupId}:${deviceTimeZone}`;
}

/**
 * Whether 群組頁 should ask to switch the group to the device's zone: only when the two
 * zones differ in their UTC offset right now (Taipei and Singapore share one, so that is no
 * disagreement), the device's zone is one we can store, and this device hasn't already
 * declined for this device zone. A change of the device's zone asks again, because the key
 * carries it.
 */
export function shouldPromptTimezone(input: {
  deviceTimeZone: string | null | undefined;
  groupTimeZone: string;
  dismissed: boolean;
  at?: Date;
}): boolean {
  const { deviceTimeZone, groupTimeZone, dismissed, at = new Date() } = input;
  if (!isValidTimeZone(deviceTimeZone) || !isValidTimeZone(groupTimeZone)) return false;
  if (dismissed) return false;
  return !sameOffset(deviceTimeZone, groupTimeZone, at);
}

/** The zone this device reports. Browser-only: on a server it is the server's zone. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
