import type { MessageEntity } from "grammy/types";
import { z } from "zod";

import { BTN } from "./buttons";
import { SUPPORTED_CURRENCIES } from "./zod";

/**
 * `/add` input parsing.
 *
 * The grammar is deliberately tiny — one line, `金額 [幣別] [說明] [@人 …]`.
 * Everything else (who splits, per-person shares, changing the currency) is
 * done with the inline buttons on the expense card, so there is no syntax to
 * memorise. What this module *does* spend effort on is forgiveness: thousands
 * separators, full-width characters, currency decorations, k/萬 multipliers and
 * simple arithmetic all parse instead of erroring out.
 */

/**
 * User-facing usage text, shown whenever someone types `/add` without telling
 * us anything — a bare `/add` in a group is the moment they most need it, so it
 * carries the same content as `/help`'s 記一筆 section rather than an abridged
 * version. Keep the two in step (`src/bot/commands/help.ts`).
 *
 * Plain text, no HTML or Markdown: the bot sends it through the same paths that
 * echo whatever the user typed, so there is no escaping dance.
 */
export const ADD_USAGE = [
  "記一筆花費：/add 金額 說明",
  "例如：/add 500 晚餐",
  "",
  "金額怎麼寫都行：1,200 · 300元 · 3k · 150+200",
  "別的幣別：/add 3000 JPY 拉麵",
  "只給某些人分：/add 500 晚餐 @alice @bob",
  "",
  `記完點訊息下方的「${BTN.adjust}」：`,
  `${BTN.who} · ${BTN.shares} · ${BTN.currency} · ${BTN.amount}`,
].join("\n");

/* ── input normalisation ──────────────────────────────────────────────── */

/**
 * Full-width / typographic characters that mean the same thing as an ASCII one.
 * Every entry MUST map to a single-code-unit replacement so the normalised
 * string stays index-compatible with the original — Telegram entity offsets
 * point into the original text.
 */
const WIDTH_MAP: Record<string, string> = {
  "０": "0",
  "１": "1",
  "２": "2",
  "３": "3",
  "４": "4",
  "５": "5",
  "６": "6",
  "７": "7",
  "８": "8",
  "９": "9",
  "，": ",",
  "．": ".",
  "＋": "+",
  "－": "-",
  "−": "-",
  "–": "-",
  "—": "-",
  "＊": "*",
  "×": "*",
  "✕": "*",
  "／": "/",
  "÷": "/",
  "（": "(",
  "）": ")",
  "％": "%",
  "＄": "$",
  "＠": "@",
  // Every flavour of space becomes a plain one — a pasted NBSP or a tab after
  // the amount must not make the whole command unreadable.
  "　": " ",
  " ": " ",
  "\t": " ",
  " ": " ",
  " ": " ",
  " ": " ",
};

/** Map full-width/typographic characters to ASCII, preserving string length. */
export function normalizeWidth(s: string): string {
  let out = "";
  for (const ch of s) out += WIDTH_MAP[ch] ?? ch;
  return out;
}

/* ── currencies ───────────────────────────────────────────────────────── */

/**
 * Currency codes recognised in `/add` text — exactly the set the rest of the
 * app supports. It has to be this list and nothing wider: a bot-created expense
 * in an unsupported currency can't be rendered or saved by the Mini App form
 * (`expenseInputSchema.currency` is a `z.enum` over the same constant), and an
 * unknown code makes `getRate` fail, which breaks `/balance` for the whole group.
 *
 * A curated list also stops ordinary words that happen to be ISO 4217 codes
 * (ALL, CUP, TOP) from being read as a currency instead of the description.
 */
const KNOWN_CURRENCIES: ReadonlySet<string> = new Set(SUPPORTED_CURRENCIES);

/** True if `code` is a currency the whole app can handle. */
export function isSupportedCurrency(code: string): boolean {
  return KNOWN_CURRENCIES.has(code.toUpperCase());
}

/** Currency symbols written before the number. `null` = decoration only (use the group default). */
const PREFIX_SYMBOLS: Array<[string, string | null]> = [
  ["NT$", "TWD"],
  ["US$", "USD"],
  ["HK$", "HKD"],
  ["¥", "JPY"],
  ["€", "EUR"],
  ["£", "GBP"],
  ["₩", "KRW"],
  ["$", null],
];

/** Currency words written after the number. `null` = decoration only. */
const SUFFIX_SYMBOLS: Array<[string, string | null]> = [
  ["円", "JPY"],
  ["元", null],
  ["塊", null],
  ["圓", null],
];

/* ── arithmetic ───────────────────────────────────────────────────────── */

type Tok = { t: "n"; v: number } | { t: "o"; v: string };

const MULT_1E3 = "kK千";
const MULT_1E4 = "wW萬万";

function tokenize(src: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " ") {
      i++;
      continue;
    }
    if ("+-*/()".includes(c)) {
      toks.push({ t: "o", v: c });
      i++;
      continue;
    }
    if (/[\d.,]/.test(c)) {
      let j = i;
      while (j < src.length && /[\d.,]/.test(src[j])) j++;
      const v = Number(src.slice(i, j).replace(/,/g, ""));
      if (!Number.isFinite(v)) return null;
      i = j;
      // NB: "abc".includes("") is true, so an absent character must be excluded first.
      const mult = src[i];
      const scale = !mult
        ? 1
        : MULT_1E3.includes(mult)
          ? 1_000
          : MULT_1E4.includes(mult)
            ? 10_000
            : 1;
      if (scale !== 1) i++;
      toks.push({ t: "n", v: v * scale });
      continue;
    }
    return null;
  }
  return toks;
}

/** Recursive-descent evaluator over the token list. Returns null on any syntax error. */
function evaluate(toks: Tok[]): number | null {
  let pos = 0;
  const peek = () => toks[pos];
  const eatOp = (v: string) => {
    const t = peek();
    if (t && t.t === "o" && t.v === v) {
      pos++;
      return true;
    }
    return false;
  };

  function primary(): number | null {
    const t = peek();
    if (!t) return null;
    if (t.t === "n") {
      pos++;
      return t.v;
    }
    if (t.v === "(") {
      pos++;
      const v = expr();
      if (v === null || !eatOp(")")) return null;
      return v;
    }
    return null;
  }

  function unary(): number | null {
    if (eatOp("-")) {
      const v = unary();
      return v === null ? null : -v;
    }
    if (eatOp("+")) return unary();
    return primary();
  }

  function term(): number | null {
    let left = unary();
    if (left === null) return null;
    for (;;) {
      if (eatOp("*")) {
        const r = unary();
        if (r === null) return null;
        left *= r;
      } else if (eatOp("/")) {
        const r = unary();
        if (r === null || r === 0) return null;
        left /= r;
      } else return left;
    }
  }

  function expr(): number | null {
    let left = term();
    if (left === null) return null;
    for (;;) {
      if (eatOp("+")) {
        const r = term();
        if (r === null) return null;
        left += r;
      } else if (eatOp("-")) {
        const r = term();
        if (r === null) return null;
        left -= r;
      } else return left;
    }
  }

  const value = expr();
  return value !== null && pos === toks.length ? value : null;
}

/**
 * Evaluate an amount expression: `1,200`, `3k`, `1.5萬`, `150+200`, `(300+150)/3`.
 * Returns the value rounded to the cent, or null if it isn't a valid expression.
 */
export function evalAmountExpr(raw: string): number | null {
  const toks = tokenize(normalizeWidth(raw).trim());
  if (!toks || toks.length === 0) return null;
  const v = evaluate(toks);
  if (v === null || !Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

/* ── amount scanning ──────────────────────────────────────────────────── */

export type AmountScan = {
  value: number;
  /** Explicit currency from a symbol or code, or null to use the group default. */
  currency: string | null;
  /** Index in the source string just past the amount (and its currency). */
  end: number;
};

const skipSpaces = (s: string, i: number) => {
  while (s[i] === " ") i++;
  return i;
};

/**
 * Read the leading amount (plus optional currency) out of `norm`, which must
 * already be width-normalised. The amount has to end on whitespace or
 * end-of-string, so `3杯咖啡` is *not* read as 3 — a stray number glued to a
 * word is a typo, not an amount.
 */
export function scanAmount(norm: string, start: number): AmountScan | null {
  let i = skipSpaces(norm, start);
  let currency: string | null = null;
  let sawSymbol = false;

  for (const [sym, code] of PREFIX_SYMBOLS) {
    if (norm.slice(i, i + sym.length).toUpperCase() === sym) {
      currency = code;
      sawSymbol = true;
      i += sym.length;
      break;
    }
  }
  i = skipSpaces(norm, i);

  const exprStart = i;
  if (!/[\d(]/.test(norm[i] ?? "")) return null;

  let depth = 0;
  let last: "n" | "o" = "o";
  while (i < norm.length) {
    const c = norm[i];
    if (/[\d.,]/.test(c)) {
      i++;
      last = "n";
      continue;
    }
    if (last === "n" && (MULT_1E3.includes(c) || MULT_1E4.includes(c))) {
      i++;
      continue;
    }
    if ("+-*/".includes(c)) {
      // Only an operator when a number follows — otherwise it's something else
      // entirely (a hyphen before a name, a dangling sign) and the amount ends here.
      const j = skipSpaces(norm, i + 1);
      if (!/[\d(]/.test(norm[j] ?? "")) break;
      i++;
      last = "o";
      continue;
    }
    if (c === "(") {
      depth++;
      i++;
      last = "o";
      continue;
    }
    if (c === ")") {
      if (depth === 0) break;
      depth--;
      i++;
      last = "n";
      continue;
    }
    if (c === " ") {
      const j = skipSpaces(norm, i);
      const nc = norm[j] ?? "";
      if (last === "o" && /[\d(]/.test(nc)) {
        i = j;
        continue;
      }
      // A *spaced* operator continues the expression — except for "-", which is
      // far more often a dash before the description ("/add 1000 - 2 樓餐廳"
      // means 1000 at 2樓餐廳, not 998). Unspaced "1000-2" is still subtraction.
      if (last === "n" && "+*/".includes(nc)) {
        const k = skipSpaces(norm, j + 1);
        if (/[\d(]/.test(norm[k] ?? "")) {
          i = j;
          continue;
        }
      }
      break;
    }
    break;
  }

  const value = evalAmountExpr(norm.slice(exprStart, i));
  if (value === null) return null;

  if (!sawSymbol) {
    // Attached ISO code: `300usd`
    const attached = /^[A-Za-z]{3}(?![A-Za-z])/.exec(norm.slice(i));
    if (attached && KNOWN_CURRENCIES.has(attached[0].toUpperCase())) {
      currency = attached[0].toUpperCase();
      i += 3;
    } else {
      const suffix = SUFFIX_SYMBOLS.find(([sym]) => norm.startsWith(sym, i));
      if (suffix) {
        currency = suffix[1];
        i += suffix[0].length;
      } else {
        // Separate ISO code: `300 USD`
        const spaced = /^\s+([A-Za-z]{3})(?![A-Za-z])/.exec(norm.slice(i));
        if (spaced && KNOWN_CURRENCIES.has(spaced[1].toUpperCase())) {
          currency = spaced[1].toUpperCase();
          i += spaced[0].length;
        }
      }
    }
  }

  const endCh = norm[i];
  if (endCh !== undefined && endCh !== " ") return null;

  return { value, currency, end: i };
}

/* ── message parsing ──────────────────────────────────────────────────── */

export const parsedAddSchema = z.object({
  amount: z.number().positive(),
  /** Explicit currency, or null to fall back to the group default. */
  currency: z.string().length(3).nullable(),
  description: z.string().nullable(),
  /** When non-empty, only these people split the expense. */
  mentionUsernames: z.array(z.string().min(1)),
  mentionTelegramIds: z.array(z.number().int().positive()),
});

export type ParsedAdd = z.infer<typeof parsedAddSchema>;

export function parseAddMessage(text: string, entities: readonly MessageEntity[] = []): ParsedAdd {
  const norm = normalizeWidth(text);
  const lines = norm.split("\n");
  const firstLine = lines[0];

  if (lines.slice(1).some((l) => l.trim())) {
    throw new Error(
      "多行分帳已經改用按鈕了。\n" +
        `先記「/add 500 晚餐」，再點訊息下方的「${BTN.adjust}」選誰分、改份數。`,
    );
  }

  const cmdMatch = firstLine.match(/^\/add(@\w+)?\s*/i);
  if (!cmdMatch) throw new Error(ADD_USAGE);

  const bodyStart = cmdMatch[0].length;
  if (!firstLine.slice(bodyStart).trim()) throw new Error(ADD_USAGE);

  const scan = scanAmount(firstLine, bodyStart);
  if (!scan) {
    const token = firstLine.slice(bodyStart).split(/\s+/)[0];
    throw new Error(`看不懂金額「${token}」。\n第一個字要是金額，例如：/add 500 晚餐`);
  }
  if (scan.value <= 0) throw new Error("金額要大於 0。");

  // Mentions pick who splits; they're cut out of the description so
  // "/add 600 晚餐 @alice" describes 晚餐, not "晚餐 @alice".
  const mentionUsernames: string[] = [];
  const mentionTelegramIds: number[] = [];
  const mentionRanges: Array<[number, number]> = [];
  for (const e of entities) {
    if (e.offset >= firstLine.length) continue;
    if (e.type === "mention") {
      const slice = norm.slice(e.offset, e.offset + e.length);
      if (slice.startsWith("@")) {
        mentionUsernames.push(slice.slice(1).toLowerCase());
        mentionRanges.push([e.offset, e.offset + e.length]);
      }
    } else if (e.type === "text_mention" && e.user && !e.user.is_bot) {
      mentionTelegramIds.push(e.user.id);
      mentionRanges.push([e.offset, e.offset + e.length]);
    }
  }

  // Read the description from the ORIGINAL text so full-width punctuation the
  // user typed survives; only the amount/mention spans are cut out.
  const descChars: string[] = [];
  for (let i = scan.end; i < firstLine.length; i++) {
    if (!mentionRanges.some(([s, e]) => i >= s && i < e)) descChars.push(text[i]);
  }
  const description = descChars.join("").replace(/\s+/g, " ").trim();

  return parsedAddSchema.parse({
    amount: scan.value,
    currency: scan.currency,
    description: description || null,
    mentionUsernames,
    mentionTelegramIds,
  });
}
