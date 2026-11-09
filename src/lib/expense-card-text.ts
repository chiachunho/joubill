import { labelUser, type Profile } from "@/lib/label";
import { fmtGrouped } from "@/lib/money";
import { escapeHtml, mention } from "@/lib/telegram-html";

/**
 * The text of an expense card, without its panel hint or keyboard. Pure, so the layout
 * is unit-tested and the same lines can be reused wherever an expense is summarised
 * (the card in the group, the private-chat confirmation).
 *
 *   <b>晚餐</b>　小明 付 <b>600 TWD</b>
 *   ・小明 200
 *   ・阿華 200
 *
 * One person per line, because a long name squeezed into "A、B、C 各 200" wraps into
 * something unreadable. With several payers each line says what that person paid and
 * what their share is, so nobody has to match two lists up.
 */

export type CardPerson = Profile & { id: number; telegramId: number | null };

export type ExpenseCardInput = {
  description: string | null;
  amount: number;
  currency: string;
  /** The amount in the group's default currency, when the expense is in another one. */
  converted: { amount: number; currency: string } | null;
  payers: Array<{ user: CardPerson; amount: number }>;
  splits: Array<{ user: CardPerson; amount: number; weight: number }>;
};

function name(u: CardPerson): string {
  return mention(labelUser(u), u.telegramId);
}

function weightOf(weight: number): string {
  return weight !== 1 ? ` ×${fmtGrouped(weight)}` : "";
}

/** `<b>晚餐</b>　小明 付 <b>600 TWD</b>（≈ 2,800 JPY）` */
export function cardHeadline(e: ExpenseCardInput): string {
  const who = e.payers.length > 0 ? e.payers.map((p) => name(p.user)).join("、") : "?";
  const money = `<b>${fmtGrouped(e.amount)} ${e.currency}</b>`;
  const fx = e.converted ? `（≈ ${fmtGrouped(e.converted.amount)} ${e.converted.currency}）` : "";
  const desc = e.description ? `<b>${escapeHtml(e.description)}</b>　` : "";
  return `${desc}${who} 付 ${money}${fx}`;
}

/** The per-person lines under the headline. */
export function cardPeopleLines(e: ExpenseCardInput): string[] {
  if (e.splits.length === 0) return ["（沒有人分帳）"];

  // One payer is already named in the headline, so each line only needs the share.
  if (e.payers.length <= 1) {
    return e.splits.map((s) => `・${name(s.user)}${weightOf(s.weight)} ${fmtGrouped(s.amount)}`);
  }

  // Several payers: payers first (in payer order), then everyone else who only owes.
  const share = new Map(e.splits.map((s) => [s.user.id, s]));
  const lines = e.payers.map((p) => {
    const s = share.get(p.user.id);
    const owes = s ? `，分 ${fmtGrouped(s.amount)}` : "";
    return `・${name(p.user)}${weightOf(s?.weight ?? 1)} 付 ${fmtGrouped(p.amount)}${owes}`;
  });
  const paid = new Set(e.payers.map((p) => p.user.id));
  for (const s of e.splits) {
    if (!paid.has(s.user.id)) {
      lines.push(`・${name(s.user)}${weightOf(s.weight)} 分 ${fmtGrouped(s.amount)}`);
    }
  }
  return lines;
}

export function cardBody(e: ExpenseCardInput): string[] {
  return [cardHeadline(e), ...cardPeopleLines(e)];
}
