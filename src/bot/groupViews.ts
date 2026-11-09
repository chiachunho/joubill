import { InlineKeyboard } from "grammy";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { expensePayers, expenseSplits, expenses, users, type Group } from "@/db/schema";
import { button } from "@/lib/buttons";
import { telegramChatId } from "@/lib/chat";
import { groupLink } from "@/lib/deep-link";
import { clientEnv } from "@/lib/env";
import { fmtGrouped } from "@/lib/money";
import { computeGroupBalances, minimizeTransfers } from "@/lib/settlement";

import { escapeHtml } from "./format";
import { loadMentionMap } from "./profiles";

/**
 * What `/list`, `/balance` and `/settle` show for a group. The text is the same whether
 * the command was typed in the group's chat or in a private chat with the bot, so it is
 * built here from the group alone; the caller only says where it will be sent.
 */

export type ViewTarget = { botUsername: string; inPrivate: boolean };
export type GroupView = { text: string; reply_markup?: InlineKeyboard };

/** Said by /balance and /settle alike when nobody owes anybody. */
export const ALL_SETTLED = "大家都結清了 🎉";

/**
 * 開啟揪帳 for a group. A group with a chat opens straight into it through its `startapp`
 * link; a web group has no chat id to link with, so in a private chat it opens the app's
 * group list instead (a `web_app` button only works in private chats).
 */
export function openAppKeyboard(
  group: Group,
  target: ViewTarget,
  kb: InlineKeyboard = new InlineKeyboard(),
): InlineKeyboard {
  const chatId = telegramChatId(group);
  return chatId !== null
    ? kb.url(button("openApp"), groupLink(target.botUsername, chatId))
    : kb.webApp(button("openApp"), clientEnv.NEXT_PUBLIC_MINI_APP_URL);
}

/** The callback data of 怎麼還 on a /balance reply: `settle:<group id>`. */
export function settleCallback(groupId: number): string {
  return `settle:${groupId}`;
}

export function parseSettleCallback(data: string): number | null {
  const m = /^settle:(\d+)$/.exec(data);
  return m ? Number(m[1]) : null;
}

/** `/balance`: who should receive and who should pay, in the group's default currency. */
export async function balanceView(group: Group, target: ViewTarget): Promise<GroupView> {
  const currency = group.defaultCurrency;
  const balances = await computeGroupBalances(group.id, currency);
  if (balances.length === 0) return { text: ALL_SETTLED };

  const mentionOf = await loadMentionMap(balances.map((b) => b.userId));
  // Receiving first, then paying. 應收 / 應付 say the direction, so no sign or colour.
  const lines = [...balances]
    .sort((a, b) => b.amount - a.amount)
    .map(
      (b) =>
        `・${mentionOf(b.userId)} ${b.amount >= 0 ? "應收" : "應付"} <b>${fmtGrouped(Math.abs(b.amount))}</b>`,
    );

  // 怎麼還 first: after the balances, how to settle them is usually the next question.
  const keyboard = new InlineKeyboard().text(button("howToSettle"), settleCallback(group.id));
  return {
    text: `💰 <b>${escapeHtml(group.title)}　餘額</b>（${currency}）\n` + lines.join("\n"),
    reply_markup: openAppKeyboard(group, target, keyboard),
  };
}

/** `/settle`: the fewest transfers that settle the group, and where to record them. */
export async function settleView(group: Group, target: ViewTarget): Promise<GroupView> {
  const currency = group.defaultCurrency;
  const transfers = minimizeTransfers(await computeGroupBalances(group.id, currency));
  if (transfers.length === 0) return { text: ALL_SETTLED };

  const mentionOf = await loadMentionMap(
    Array.from(new Set(transfers.flatMap((t) => [t.fromUserId, t.toUserId]))),
  );
  const lines = transfers.map(
    (t) => `${mentionOf(t.fromUserId)} → ${mentionOf(t.toUserId)} <b>${fmtGrouped(t.amount)}</b>`,
  );
  return {
    text:
      `🤝 <b>${escapeHtml(group.title)}　怎麼還</b>（${currency}）\n` +
      lines.join("\n") +
      "\n<i>還完在 App 記一筆還款</i>",
    // Recording a repayment only happens in the app, so this is the way there.
    reply_markup: openAppKeyboard(group, target),
  };
}

const LIST_SIZE = 10;

/**
 * `/list`: the latest records, expenses and repayments alike, one line each.
 *
 *   11/09　<b>晚餐</b> 600 · 小明
 *   11/08　💸 阿華 → 小明 300
 *
 * The group's own currency is left off; only a foreign amount names its currency.
 */
export async function listView(group: Group, target: ViewTarget): Promise<GroupView> {
  const rows = await db
    .select({
      id: expenses.id,
      type: expenses.type,
      amount: expenses.amount,
      currency: expenses.currency,
      description: expenses.description,
      spentAt: expenses.spentAt,
    })
    .from(expenses)
    .where(eq(expenses.groupId, group.id))
    .orderBy(desc(expenses.spentAt), desc(expenses.id))
    .limit(LIST_SIZE);

  if (rows.length === 0) return { text: "還沒有紀錄，試試 <code>/add 50 飲料</code>" };

  const ids = rows.map((r) => r.id);
  const nameCols = {
    displayName: users.displayName,
    firstName: users.firstName,
    username: users.username,
  };
  const [payerRows, receiverRows] = await Promise.all([
    db
      .select({ ...nameCols, expenseId: expensePayers.expenseId })
      .from(expensePayers)
      .innerJoin(users, eq(users.id, expensePayers.payerId))
      .where(inArray(expensePayers.expenseId, ids))
      .orderBy(expensePayers.id),
    // A repayment's receiver is its one split row.
    db
      .select({ ...nameCols, expenseId: expenseSplits.expenseId })
      .from(expenseSplits)
      .innerJoin(expenses, eq(expenses.id, expenseSplits.expenseId))
      .innerJoin(users, eq(users.id, expenseSplits.debtorId))
      .where(and(inArray(expenseSplits.expenseId, ids), eq(expenses.type, "settlement"))),
  ]);

  // A chosen name first; otherwise the @handle, which is shorter than most full names,
  // then the provider's first name.
  const short = (p: { displayName: string | null; username: string | null; firstName: string }) =>
    escapeHtml(p.displayName ?? (p.username ? "@" + p.username : p.firstName));
  const namesBy = (list: typeof payerRows) => {
    const out = new Map<number, string[]>();
    for (const p of list) out.set(p.expenseId, [...(out.get(p.expenseId) ?? []), short(p)]);
    return out;
  };
  const payers = namesBy(payerRows);
  const receivers = namesBy(receiverRows);

  const lines = rows.map((r) => {
    const date = r.spentAt.slice(5, 10).replace("-", "/");
    const cur = r.currency === group.defaultCurrency ? "" : ` ${r.currency}`;
    const amount = `${fmtGrouped(Number(r.amount))}${cur}`;
    const who = (payers.get(r.id) ?? ["?"]).join("、");
    if (r.type === "settlement") {
      const to = (receivers.get(r.id) ?? ["?"]).join("、");
      return `${date}　💸 ${who} → ${to} ${amount}`;
    }
    const desc = r.description ? `<b>${escapeHtml(r.description)}</b> ` : "";
    return `${date}　${desc}${amount} · ${who}`;
  });

  return {
    text: `<b>最近 ${rows.length} 筆</b>\n` + lines.join("\n"),
    reply_markup: openAppKeyboard(group, target),
  };
}

/** How many groups a private /balance lists; the rest are a tap away in the app. */
const MY_BALANCES_SIZE = 10;

/**
 * A private `/balance`: where the person stands in each of their groups, one line each,
 * each in that group's own currency (they are not added up). Pressing a group's button
 * opens that group's full balance.
 */
export async function myBalancesView(
  userId: number,
  groups: Group[],
  pickData: (groupId: number) => string,
): Promise<GroupView> {
  const shown = groups.slice(0, MY_BALANCES_SIZE);
  const mine = await Promise.all(
    shown.map(async (g) => {
      const balances = await computeGroupBalances(g.id, g.defaultCurrency);
      return balances.find((b) => b.userId === userId)?.amount ?? 0;
    }),
  );

  const lines = shown.map((g, i) => {
    const amount = mine[i];
    const title = escapeHtml(g.title);
    if (amount === 0) return `・${title} 已結清`;
    const money = `<b>${fmtGrouped(Math.abs(amount))} ${g.defaultCurrency}</b>`;
    return `・${title} ${amount > 0 ? "應收" : "應付"} ${money}`;
  });

  const kb = new InlineKeyboard();
  shown.forEach((g, i) => {
    kb.text(g.title, pickData(g.id));
    if (i % 2 === 1) kb.row();
  });
  return { text: "<b>你的餘額</b>\n" + lines.join("\n"), reply_markup: kb };
}
