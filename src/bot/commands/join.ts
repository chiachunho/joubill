import { Composer, InlineKeyboard } from "grammy";

import { BTN } from "@/lib/buttons";
import { db } from "@/db";
import { groupMembers } from "@/db/schema";
import type { User as DbUser } from "@/db/schema";
import { upsertTelegramUser } from "@/lib/auth/upsertTelegramUser";
import { escapeHtml, mention } from "../format";
import { labelUser } from "@/lib/label";
import { parseMentions, replyTargetUser } from "@/lib/parseMentions";

import { canVerifyMembership, verifyInChat, type Presence } from "../membership";
import type { BotContext } from "../context";
import { groupMiniAppLink } from "./start";

export const joinCommand = new Composer<BotContext>();

const USAGE = "<b>回覆</b>對方的任何一則訊息，再打 <code>/join</code>，就會把他加進揪帳。";

/**
 * A typed-out `@handle` is deliberately never resolved. The Bot API has no
 * username → id lookup, so the only thing we could do is guess against
 * `users.username`, which is neither unique nor refreshed until its owner next
 * touches the bot. A handle that has changed hands would then quietly seat the
 * wrong person in the ledger — and `verifyInChat` can't catch it, because the
 * stale account is usually still in the chat. Better to do nothing and say why.
 *
 * Only the reply form is suggested. `text_mention` still works and is still
 * accepted below, but Telegram now rewrites an @-list pick into a plain
 * `@username` for any account that has one, so it fires for so few people that
 * offering it as an instruction mostly sends users down a path that won't work.
 */
const HANDLE_HINT = "改成<b>回覆</b>他的訊息再打 <code>/join</code>。";

/** One person's outcome, bucketed for the summary reply. */
type Outcome = "added" | "already" | "notInChat" | "unverifiable";

function nameOf(u: DbUser): string {
  return mention(labelUser(u), u.telegramId);
}

joinCommand.command("join", async (ctx) => {
  const group = ctx.dbGroup;
  if (!group) {
    await ctx.reply("這個指令只能在群組裡使用。");
    return;
  }

  const { users: mentionedUsers, usernames: mentionedHandles } = parseMentions(
    ctx.message?.text ?? "",
    ctx.message?.entities ?? [],
    ctx.me.username,
  );

  // The two inputs that yield a real user id. Replying is the one we document;
  // text_mention is kept because it costs nothing and still identifies the few
  // accounts with no username, which are the only ones Telegram still lets you
  // pick from the @ list as a name rather than rewriting to a plain @handle.
  const replyTarget = replyTargetUser(ctx.message?.reply_to_message);
  const identified = replyTarget ? [replyTarget, ...mentionedUsers] : mentionedUsers;

  // Drop handles naming someone we already identified, so replying to Alice while
  // also typing @alice doesn't nag about @alice. (parseMentions does this for its
  // own entities; the reply target arrives after it runs.)
  const identifiedHandles = new Set(
    identified.map((u) => u.username?.toLowerCase()).filter(Boolean),
  );
  const staleHandles = mentionedHandles.filter((h) => !identifiedHandles.has(h));

  if (identified.length === 0 && staleHandles.length === 0) {
    await ctx.reply(USAGE, { parse_mode: "HTML" });
    return;
  }

  // Dedupe on the db id before spending an API call — the same person can arrive
  // as both a text_mention and the reply target. Upserting also lets a rename
  // land even when they turn out to be an existing member.
  const candidates: DbUser[] = [];
  const seen = new Set<number>();
  for (const tgUser of identified) {
    const u = await upsertTelegramUser(tgUser);
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    candidates.push(u);
  }

  // getChatMember is only trustworthy about other people while the bot is an
  // administrator (see canVerifyMembership). When it isn't, it can answer `left`
  // for someone who really is a member — and acting on that would make /join
  // refuse the very people it exists to add, in exactly the setup deployment
  // calls optional. So fall back to the sender's intent: deliberately replying
  // to someone and typing /join is a stronger signal than an answer we know we
  // can't rely on.
  const canVerify =
    candidates.length > 0 && (await canVerifyMembership(ctx.api, ctx.chat.id, ctx.me.id));

  // One round trip each, in parallel — a /join naming several people shouldn't
  // serialise its API calls into the function's timeout.
  const presence: Presence[] = canVerify
    ? await Promise.all(candidates.map((u) => verifyInChat(ctx.api, ctx.chat.id, u.telegramId)))
    : candidates.map(() => "in");

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
  if (staleHandles.length) {
    lines.push(
      `⚠️ 認不出這樣打的 @：${staleHandles.map((h) => "@" + escapeHtml(h)).join("、")}`,
      HANDLE_HINT,
    );
  }

  // The button lets people seat themselves (opening the Mini App through a group
  // link auto-joins), so it's only worth offering when someone was left out.
  const keyboard = staleHandles.length
    ? new InlineKeyboard().url(BTN.openAppArrow, groupMiniAppLink(ctx.me.username, ctx.chat.id))
    : undefined;

  await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: keyboard });
});
