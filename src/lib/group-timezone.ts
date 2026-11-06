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

  // Locked, so two members changing it at once each log the zone they really replaced.
  const from = await db.transaction(async (tx) => {
    const [group] = await tx
      .select({ timezone: groups.timezone })
      .from(groups)
      .where(eq(groups.id, groupId))
      .for("update");
    if (!group) return null;
    if (group.timezone !== to) {
      await tx
        .update(groups)
        .set({ timezone: to, updatedAt: new Date() })
        .where(eq(groups.id, groupId));
    }
    return group.timezone;
  });
  if (from === null) return { ok: false, reason: "not_found" };
  if (from === to) return { ok: true, from, to, changed: false };

  await logTimezoneChanged(groupId, actor, { from, to });
  return { ok: true, from, to, changed: true };
}
