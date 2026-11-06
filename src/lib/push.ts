import { and, eq, inArray, sql } from "drizzle-orm";
import { after } from "next/server";
import webpush, { WebPushError } from "web-push";

import { db } from "@/db";
import { groupMembers, groups, pushSubscriptions, users } from "@/db/schema";
import { formatPushNotice, recordPushTag, type PushPayload } from "@/lib/push-notice";
import { pushRecipients, type PushAction } from "@/lib/push-plan";
import type { RecordSnapshot } from "@/lib/record-audit";
import { connectionName } from "@/lib/record-via";

/**
 * Web Push delivery (issue #67). Called only from `src/lib/record-mutation.ts`, the layer every
 * record change already goes through for the audit log and the group message, so no mutation
 * site can forget it.
 *
 * Optional like the extra login providers: without the three VAPID variables nothing is sent
 * and the 通知 section is hidden. Every failure is swallowed — a push is a nudge, and must
 * never fail a save the person already believes succeeded.
 */

export function pushConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
  );
}

let vapidSet = false;
function ensureVapid(): boolean {
  if (!pushConfigured()) return false;
  if (!vapidSet) {
    try {
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT!,
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
        process.env.VAPID_PRIVATE_KEY!,
      );
    } catch (err) {
      // A malformed key or a subject that isn't mailto:/https: throws here, which would
      // otherwise turn the test button into a 500 instead of its "failed" answer.
      console.error("[push] invalid VAPID settings:", err);
      return false;
    }
    vapidSet = true;
  }
  return true;
}

type Target = { id: number; endpoint: string; p256dh: string; auth: string };

/** A day: a notification about a record that arrives later than that is noise. */
const TTL_SECONDS = 24 * 60 * 60;

/** Sends one payload to each target. Gone subscriptions (404/410) are deleted. */
async function deliver(
  messages: { target: Target; payload: PushPayload }[],
  topic?: string,
): Promise<{ sent: number; failed: number }> {
  if (messages.length === 0 || !ensureVapid()) return { sent: 0, failed: 0 };

  const results = await Promise.allSettled(
    messages.map(({ target, payload }) =>
      webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        // The topic makes the push service replace an undelivered notification about the
        // same record (three quick 👥 誰分 taps arrive as one); the `tag` does it on the device.
        { TTL: TTL_SECONDS, urgency: "normal", ...(topic ? { topic } : {}) },
      ),
    ),
  );

  const gone: number[] = [];
  const ok: number[] = [];
  results.forEach((r, i) => {
    const id = messages[i].target.id;
    if (r.status === "fulfilled") ok.push(id);
    else if (
      r.reason instanceof WebPushError &&
      (r.reason.statusCode === 404 || r.reason.statusCode === 410)
    ) {
      gone.push(id);
    } else console.error("[push] send failed:", r.reason);
  });

  try {
    if (gone.length > 0)
      await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
    if (ok.length > 0) {
      await db
        .update(pushSubscriptions)
        .set({ lastSuccessAt: sql`now()` })
        .where(inArray(pushSubscriptions.id, ok));
    }
  } catch (err) {
    console.error("[push] bookkeeping failed:", err);
  }
  return { sent: ok.length, failed: messages.length - ok.length };
}

/**
 * Runs `task` after the response is sent when inside a request (route handlers, and the bot's
 * webhook route), otherwise right away. Never throws.
 */
function inBackground(task: () => Promise<void>): void {
  const safe = () =>
    task().catch((err) => {
      console.error("[push] failed:", err);
    });
  try {
    after(safe);
  } catch {
    void safe();
  }
}

export type RecordPushEvent = {
  action: PushAction;
  groupId: number;
  recordId: number;
  before: RecordSnapshot | null;
  after: RecordSnapshot | null;
  creatorId: number | null;
  actor: { userId: number; agentConnectionId?: number };
};

/** Notifies the people a record change touches (`pushRecipients`), in the background. */
export function queueRecordPush(event: RecordPushEvent): void {
  if (!pushConfigured()) return;
  const recipients = pushRecipients({
    action: event.action,
    before: event.before,
    after: event.after,
    creatorId: event.creatorId,
    actorId: event.actor.userId,
  });
  if (recipients.length === 0) return;

  inBackground(async () => {
    // Three independent reads, so one round trip's wait instead of three.
    const [[group], targets, [actor], via] = await Promise.all([
      db.select({ title: groups.title }).from(groups).where(eq(groups.id, event.groupId)),
      // Only current, unmuted members: someone removed from the group has no business
      // hearing about its records any more.
      db
        .select({
          id: pushSubscriptions.id,
          userId: pushSubscriptions.userId,
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
        })
        .from(pushSubscriptions)
        .innerJoin(
          groupMembers,
          and(
            eq(groupMembers.userId, pushSubscriptions.userId),
            eq(groupMembers.groupId, event.groupId),
          ),
        )
        .where(
          and(inArray(pushSubscriptions.userId, recipients), eq(groupMembers.pushMuted, false)),
        ),
      db
        .select({
          userId: users.id,
          displayName: users.displayName,
          firstName: users.firstName,
          lastName: users.lastName,
          username: users.username,
          telegramId: users.telegramId,
        })
        .from(users)
        .where(eq(users.id, event.actor.userId)),
      connectionName(event.actor.agentConnectionId),
    ]);
    if (!group || targets.length === 0) return;

    const messages = targets.flatMap((target) => {
      const payload = formatPushNotice({
        action: event.action,
        groupId: event.groupId,
        groupTitle: group.title,
        recordId: event.recordId,
        before: event.before,
        after: event.after,
        actor: actor ?? null,
        via,
        creatorId: event.creatorId,
        recipientId: target.userId,
      });
      return payload ? [{ target, payload }] : [];
    });
    await deliver(messages, recordPushTag(event.recordId));
  });
}

/** The 傳送測試通知 button: one notification to one of the caller's own devices. */
export async function sendTestPush(
  userId: number,
  endpoint: string,
): Promise<"sent" | "not-found" | "failed" | "unconfigured"> {
  if (!pushConfigured()) return "unconfigured";
  const [target] = await db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
  if (!target) return "not-found";
  const { sent } = await deliver([
    {
      target,
      payload: {
        title: "揪帳",
        body: "通知開好了。朋友記了跟你有關的帳時，會在這裡提醒你。",
        url: "/app/settings",
        tag: "test",
      },
    },
  ]);
  return sent > 0 ? "sent" : "failed";
}
