import { Composer, InlineKeyboard } from "grammy";

import { choice, GROUP_ONLY, TOAST } from "@/lib/buttons";
import { labelUser } from "@/lib/label";
import { changeGroupTimezone } from "@/lib/group-timezone";
import {
  COMMON_TIME_ZONES,
  describeTimeZone,
  isValidTimeZone,
  TIMEZONE_PURPOSE,
} from "@/lib/timezone";

import { actorOf } from "../actor";
import type { BotContext } from "../context";
import { escapeHtml } from "../format";

export const timezoneCommand = new Composer<BotContext>();

/**
 * The callback data of a zone button, built and parsed here. `tz:<group id>:<IANA name>`; the
 * longest common name keeps it well under Telegram's 64-byte limit.
 */
export function timezoneCallback(groupId: number, timeZone: string): string {
  return `tz:${groupId}:${timeZone}`;
}

export function parseTimezoneCallback(data: string): { groupId: number; timeZone: string } | null {
  const m = /^tz:(\d+):(.+)$/.exec(data);
  if (!m || !isValidTimeZone(m[2])) return null;
  return { groupId: Number(m[1]), timeZone: m[2] };
}

/** `11/06 22:40` — the group's wall clock, which is what the zone decides. */
function wallClock(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

/** The panel's text and keyboard for a group in `current`; `note` is a line above (who changed it). */
export function timezonePanel(
  groupId: number,
  current: string,
  now: Date = new Date(),
  note?: string,
) {
  const keyboard = new InlineKeyboard();
  COMMON_TIME_ZONES.forEach((z, i) => {
    const name = describeTimeZone(z.tz, now);
    keyboard.text(choice(name, z.tz === current, "single"), timezoneCallback(groupId, z.tz));
    if (i % 2 === 1) keyboard.row();
  });

  const text = [
    ...(note ? [note, ""] : []),
    `🕒 <b>群組時區　${escapeHtml(describeTimeZone(current, now))}</b>`,
    `現在 ${wallClock(current, now)}`,
    `<i>${escapeHtml(TIMEZONE_PURPOSE)}</i>`,
  ].join("\n");
  return { text, keyboard };
}

/** `/timezone` shows the zone and offers the common ones as buttons: no zone name to type. */
timezoneCommand.command("timezone", async (ctx) => {
  const group = ctx.dbGroup;
  if (!group) {
    await ctx.reply(GROUP_ONLY);
    return;
  }
  const { text, keyboard } = timezonePanel(group.id, group.timezone);
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
});

timezoneCommand.callbackQuery(/^tz:/, async (ctx) => {
  if (!ctx.dbUser || !ctx.dbGroup) {
    await ctx.answerCallbackQuery({ text: TOAST.unknownUser, show_alert: true });
    return;
  }
  const parsed = parseTimezoneCallback(ctx.callbackQuery.data);
  if (!parsed) {
    await ctx.answerCallbackQuery({ text: "找不到這個時區", show_alert: true });
    return;
  }
  // The bot-side counterpart of `assertGroupMember`: a button names a group by id, and the id
  // alone must not reach across chats.
  if (ctx.dbGroup.id !== parsed.groupId) {
    await ctx.answerCallbackQuery({ text: TOAST.staleButton, show_alert: true });
    return;
  }

  let result: Awaited<ReturnType<typeof changeGroupTimezone>>;
  try {
    result = await changeGroupTimezone(parsed.groupId, parsed.timeZone, actorOf(ctx));
  } catch (err) {
    console.error("[timezone] failed:", err);
    await ctx.answerCallbackQuery({ text: TOAST.actionFailed, show_alert: true }).catch(() => null);
    return;
  }
  if (!result.ok) {
    await ctx.answerCallbackQuery({ text: TOAST.actionFailed, show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery({
    text: result.changed ? `已改為 ${result.to}` : "已經是這個時區",
  });
  if (!result.changed) return;
  // The panel below names the zone in full, so this line keeps it short.
  const note = `✅ ${escapeHtml(labelUser(ctx.dbUser))} 改成了 ${escapeHtml(result.to)}`;
  const { text, keyboard } = timezonePanel(parsed.groupId, result.to, new Date(), note);
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard }).catch(() => null);
});
