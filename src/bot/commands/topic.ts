import { Composer, InlineKeyboard } from "grammy";
import type { Message } from "grammy/types";

import { TOAST } from "@/lib/buttons";
import { changeNoticeThread, renameNoticeThread } from "@/lib/group-notice-thread";
import { labelUser } from "@/lib/label";
import {
  NOTICE_THREAD_PURPOSE,
  noticeThreadOf,
  topicName,
  type NoticeThread,
} from "@/lib/topic-text";

import { actorOf } from "../actor";
import type { BotContext } from "../context";
import { escapeHtml } from "../format";

/**
 * `/topic`: 記帳通知發送位置, the forum topic that messages with no conversation to answer go to
 * (cards for records made in the App, exports sent from it). Like `/timezone`, the command only
 * shows a panel and a button makes the change, so a stray `/topic` in the wrong topic moves
 * nothing. The Bot API has no way to list a chat's topics, so a topic is picked by typing `/topic`
 * inside it; the App can only show the setting and put it back to General.
 */
export const topicCommand = new Composer<BotContext>();

/* ── callback data, built and parsed here ─────────────────────────────── */

export type TopicAction =
  { kind: "set"; groupId: number; threadId: number } | { kind: "clear"; groupId: number };

export function topicCallback(action: TopicAction): string {
  return action.kind === "set"
    ? `topic:set:${action.groupId}:${action.threadId}`
    : `topic:clear:${action.groupId}`;
}

export function parseTopicCallback(data: string): TopicAction | null {
  const set = /^topic:set:(\d+):(\d+)$/.exec(data);
  if (set) return { kind: "set", groupId: Number(set[1]), threadId: Number(set[2]) };
  const clear = /^topic:clear:(\d+)$/.exec(data);
  if (clear) return { kind: "clear", groupId: Number(clear[1]) };
  return null;
}

/* ── reading the topic a message is in ────────────────────────────────── */

/**
 * The topic a message was posted in, or null for General (or a chat without topics). Telegram
 * makes every message in a topic a reply to the topic's creation message unless it replies to
 * something else, so the name is read from there, and is null when the message replied elsewhere.
 */
export function topicOf(msg: Message | undefined): NoticeThread | null {
  if (!msg?.is_topic_message || msg.message_thread_id === undefined) return null;
  const created = msg.reply_to_message;
  const name =
    created?.message_id === msg.message_thread_id
      ? (created.forum_topic_created?.name ?? null)
      : null;
  return { id: msg.message_thread_id, name };
}

/* ── the panel ────────────────────────────────────────────────────────── */

export const NO_TOPICS_TEXT = "這個群組沒有開啟「主題」功能，記帳訊息都會直接發在群組裡。";

/**
 * The panel for a group whose setting is `current`, asked from topic `here` (null: General).
 * `note` is a line above it saying who just changed it.
 */
export function topicPanel(
  groupId: number,
  current: NoticeThread | null,
  here: NoticeThread | null,
  note?: string,
) {
  const keyboard = new InlineKeyboard();
  const lines = [...(note ? [note, ""] : []), "📌 <b>記帳通知發送位置</b>"];

  lines.push(
    current
      ? `目前：<b># ${escapeHtml(topicName(current.name))}</b>`
      : "目前：<b>General</b>（群組預設）",
  );
  lines.push(escapeHtml(NOTICE_THREAD_PURPOSE));

  if (here && here.id !== current?.id) {
    keyboard
      .text(
        `📌 改發到「${topicName(here.name)}」`,
        topicCallback({ kind: "set", groupId, threadId: here.id }),
      )
      .row();
  }
  if (!here) {
    lines.push(
      "",
      current
        ? "要換成別的主題，請到那個主題裡輸入 /topic。"
        : "到想要的主題裡輸入 /topic，就能把記帳通知改發到那裡。",
    );
  }
  if (current) keyboard.text("↩︎ 改回 General", topicCallback({ kind: "clear", groupId }));

  return { text: lines.join("\n"), keyboard };
}

topicCommand.command("topic", async (ctx) => {
  const group = ctx.dbGroup;
  if (!group) {
    await ctx.reply("這個指令只能在群組裡用。");
    return;
  }
  const current = noticeThreadOf(group);
  const forum = ctx.chat.type === "supergroup" && ctx.chat.is_forum === true;
  // Without topics there is nothing to choose; a setting left from before topics were turned
  // off still gets its panel, so it can be put back to General.
  if (!forum && !current) {
    await ctx.reply(NO_TOPICS_TEXT);
    return;
  }
  const { text, keyboard } = topicPanel(group.id, current, topicOf(ctx.msg));
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
});

topicCommand.callbackQuery(/^topic:/, async (ctx) => {
  if (!ctx.dbUser || !ctx.dbGroup) {
    await ctx.answerCallbackQuery({ text: TOAST.unknownUser, show_alert: true });
    return;
  }
  const action = parseTopicCallback(ctx.callbackQuery.data);
  // The bot-side counterpart of `assertGroupMember`: a button names a group by id, and the id
  // alone must not reach across chats.
  if (!action || action.groupId !== ctx.dbGroup.id) {
    await ctx.answerCallbackQuery({ text: "這個按鈕已失效", show_alert: true });
    return;
  }

  // The panel sits in the topic it offers, so the topic (and its name) is read from the panel
  // itself; a thread id that doesn't match where the button is would be a forged button.
  const panelTopic = topicOf(ctx.callbackQuery.message as Message | undefined);
  let to: NoticeThread | null = null;
  if (action.kind === "set") {
    if (panelTopic?.id !== action.threadId) {
      await ctx.answerCallbackQuery({ text: "這個按鈕已失效", show_alert: true });
      return;
    }
    to = panelTopic;
  }

  let result: Awaited<ReturnType<typeof changeNoticeThread>>;
  try {
    result = await changeNoticeThread(action.groupId, to, actorOf(ctx));
  } catch (err) {
    console.error("[topic] failed:", err);
    await ctx.answerCallbackQuery({ text: TOAST.actionFailed, show_alert: true }).catch(() => null);
    return;
  }
  if (!result.ok) {
    await ctx.answerCallbackQuery({ text: TOAST.actionFailed, show_alert: true });
    return;
  }

  const where = result.to ? `「${topicName(result.to.name)}」` : "General";
  await ctx.answerCallbackQuery({ text: result.changed ? `已改發到 ${where}` : `已經是 ${where}` });
  if (!result.changed) return;
  const who = escapeHtml(labelUser(ctx.dbUser));
  const note = result.to
    ? `✅ ${who} 把記帳通知改發到「${escapeHtml(topicName(result.to.name))}」`
    : `✅ ${who} 把記帳通知改回發在 General`;
  const { text, keyboard } = topicPanel(action.groupId, result.to, panelTopic, note);
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard }).catch(() => null);
});

/** A topic renamed in Telegram: keep the stored name in step when it is the chosen topic. */
topicCommand.on("message:forum_topic_edited", async (ctx, next) => {
  const name = ctx.msg.forum_topic_edited.name;
  const threadId = ctx.msg.message_thread_id;
  if (name && threadId !== undefined) {
    await renameNoticeThread(ctx.chat.id, threadId, name).catch((err) =>
      console.error("[topic] rename failed:", err),
    );
  }
  await next();
});
