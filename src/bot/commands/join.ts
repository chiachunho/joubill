import { Composer, InlineKeyboard } from "grammy";
import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { groupMembers, users } from "@/db/schema";
import type { User as DbUser } from "@/db/schema";
import { upsertTelegramUser } from "@/lib/auth/upsertTelegramUser";
import { escapeHtml, mention } from "../format";
import { labelUser } from "@/lib/label";
import { parseMentions } from "@/lib/parseMentions";

import type { BotContext } from "../context";
import { groupMiniAppLink } from "./start";

export const joinCommand = new Composer<BotContext>();

const USAGE = [
  "用法：<code>/join @alice @bob</code>",
  "",
  "把群組裡的人一次加進揪帳。沒有 @username 的人，從輸入框打 @ 的清單裡挑他的名字就可以。",
].join("\n");

/** One person's outcome, bucketed for the summary reply. */
type Outcome = "added" | "already" | "notInChat" | "unverifiable";

function nameOf(u: DbUser): string {
  return mention(labelUser(u), u.telegramId);
}

/**
 * Confirm the target is actually in this Telegram chat before granting them a
 * seat at the ledger. Mentioning someone doesn't put them in the group — the
 * handle may belong to anyone, and an outsider in `group_members` would show up
 * in balances and split calculations.
 */
async function verifyInChat(
  api: BotContext["api"],
  chatId: number,
  telegramId: number | null,
): Promise<"in" | "out" | "unknown"> {
  // A user with no Telegram id (web-only OAuth account) can't be checked at all.
  if (telegramId === null) return "unknown";
  try {
    const member = await api.getChatMember(chatId, telegramId);
    return member.status === "left" || member.status === "kicked" ? "out" : "in";
  } catch {
    // Most often "user not found" for someone who was never in the chat, but a
    // transient API failure looks identical — don't claim to know which.
    return "unknown";
  }
}

joinCommand.command("join", async (ctx) => {
  const group = ctx.dbGroup;
  if (!group) {
    await ctx.reply("這個指令只能在群組裡使用。");
    return;
  }

  const { users: mentionedUsers, usernames } = parseMentions(
    ctx.message?.text ?? "",
    ctx.message?.entities ?? [],
    ctx.me.username,
  );

  if (mentionedUsers.length === 0 && usernames.length === 0) {
    await ctx.reply(USAGE, { parse_mode: "HTML" });
    return;
  }

  // Bare @handles only resolve if we've already recorded that username.
  const known = usernames.length
    ? await db.select().from(users).where(inArray(users.username, usernames))
    : [];

  // `users.username` is neither unique nor kept live — it only refreshes when
  // someone next touches the bot. So a handle can match several rows once it has
  // been given up and claimed by someone else, and both accounts may well still
  // be in the chat, which makes verifyInChat no help at all. Guessing here would
  // put the wrong person on the hook for money, so refuse and say so.
  const byHandle = new Map<string, DbUser[]>();
  for (const u of known) {
    const handle = u.username?.toLowerCase();
    if (!handle) continue;
    byHandle.set(handle, [...(byHandle.get(handle) ?? []), u]);
  }

  const unknownHandles = usernames.filter((h) => (byHandle.get(h)?.length ?? 0) === 0);
  const ambiguousHandles = usernames.filter((h) => (byHandle.get(h)?.length ?? 0) > 1);

  // Resolve everyone to a users row. text_mention people are upserted so a
  // rename lands even when they turn out to be an existing member; the same
  // person can arrive twice (once as an entity, once as a handle), so dedupe on
  // the db id before spending an API call on them.
  const candidates: DbUser[] = [];
  const seen = new Set<number>();
  const addCandidate = (u: DbUser) => {
    if (seen.has(u.id)) return;
    seen.add(u.id);
    candidates.push(u);
  };

  for (const tgUser of mentionedUsers) addCandidate(await upsertTelegramUser(tgUser));
  for (const handle of usernames) {
    const matches = byHandle.get(handle);
    if (matches?.length === 1) addCandidate(matches[0]);
  }

  // One round trip each, in parallel — a /join naming the whole group shouldn't
  // serialise a dozen API calls into the function's timeout.
  const presence = await Promise.all(
    candidates.map((u) => verifyInChat(ctx.api, ctx.chat.id, u.telegramId)),
  );

  const results = new Map<Outcome, DbUser[]>();
  const push = (outcome: Outcome, u: DbUser) => {
    const list = results.get(outcome) ?? [];
    list.push(u);
    results.set(outcome, list);
  };

  for (const [i, candidate] of candidates.entries()) {
    if (presence[i] === "out") {
      push("notInChat", candidate);
      continue;
    }
    if (presence[i] === "unknown") {
      push("unverifiable", candidate);
      continue;
    }

    // Empty `returning()` means the conflict clause fired — already a member.
    const inserted = await db
      .insert(groupMembers)
      .values({ groupId: group.id, userId: candidate.id })
      .onConflictDoNothing()
      .returning();

    push(inserted.length > 0 ? "added" : "already", candidate);
  }

  const lines: string[] = [];
  const added = results.get("added") ?? [];
  const already = results.get("already") ?? [];
  const notInChat = results.get("notInChat") ?? [];
  const unverifiable = results.get("unverifiable") ?? [];

  if (added.length) lines.push(`✅ 已加入 ${added.length} 人：${added.map(nameOf).join("、")}`);
  if (already.length) lines.push(`• 已經在揪帳裡：${already.map(nameOf).join("、")}`);
  if (notInChat.length)
    lines.push(`⚠️ 不在這個 Telegram 群組，沒有加入：${notInChat.map(nameOf).join("、")}`);
  if (unverifiable.length)
    lines.push(`⚠️ 無法確認是否在群組裡，沒有加入：${unverifiable.map(nameOf).join("、")}`);
  if (ambiguousHandles.length) {
    lines.push(
      `⚠️ 這些 @ 對應到不只一個人，沒有加入：${ambiguousHandles.map((h) => "@" + escapeHtml(h)).join("、")}`,
      "（username 可能換過手）請改從輸入框打 @ 的清單裡挑本人。",
    );
  }
  if (unknownHandles.length) {
    lines.push(
      `❓ 還不認識：${unknownHandles.map((h) => "@" + escapeHtml(h)).join("、")}`,
      "請他們點下面的按鈕，或在群組裡講一句話就會自動加入。",
    );
  }

  // The button is what actually unblocks unresolvable handles, so only offer it
  // when there's something for it to fix. Ambiguous ones don't qualify: those
  // people are already known, they just can't be told apart by handle.
  const keyboard = unknownHandles.length
    ? new InlineKeyboard().url("開啟揪帳 →", groupMiniAppLink(ctx.me.username, ctx.chat.id))
    : undefined;

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: keyboard });
});
