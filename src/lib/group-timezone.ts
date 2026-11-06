import { eq } from "drizzle-orm";

import { db } from "@/db";
import { groups } from "@/db/schema";

import { logTimezoneChanged, type Actor } from "./record-mutation";
import { isValidTimeZone } from "./timezone";

export type TimezoneChange =
  | { ok: true; from: string; to: string; changed: boolean }
  | { ok: false; reason: "invalid" | "not_found" };

/**
 * Set a group's time zone and log it. The one path both the settings API and the bot's
 * `/timezone` buttons take, so neither can change it without leaving a trace.
 *
 * Changing the zone moves no record: a record's date is a plain day. It only changes which
 * day "now" is for the bot's `/add` and for a market-rate lookup of today.
 */
export async function changeGroupTimezone(
  groupId: number,
  to: unknown,
  actor: Actor,
): Promise<TimezoneChange> {
  if (!isValidTimeZone(to)) return { ok: false, reason: "invalid" };

  const [group] = await db
    .select({ timezone: groups.timezone })
    .from(groups)
    .where(eq(groups.id, groupId));
  if (!group) return { ok: false, reason: "not_found" };
  if (group.timezone === to) return { ok: true, from: to, to, changed: false };

  await db
    .update(groups)
    .set({ timezone: to, updatedAt: new Date() })
    .where(eq(groups.id, groupId));
  await logTimezoneChanged(groupId, actor, { from: group.timezone, to });
  return { ok: true, from: group.timezone, to, changed: true };
}
