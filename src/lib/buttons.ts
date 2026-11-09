import type { InlineKeyboardButton } from "grammy/types";

/**
 * Inline-keyboard button labels and colours, in one place.
 *
 * The same button is rendered from more than one file: App 編輯 and ⊗ 刪除 sit
 * on both the expense card (`src/bot/expenseCard.ts`) and the settlement notice
 * (`src/lib/notify.ts`), and 開啟揪帳 is posted by many commands. Wording or a
 * colour that drifts between those call sites reads as two different features.
 *
 * Labels use monochrome symbols, never colour emoji. ☑ is the one symbol that has an
 * emoji form too, so it carries U+FE0E (text presentation) to stay monochrome.
 *
 * Scope is deliberately *button labels only*. Message bodies are not buttons: they
 * are one-off sentences that belong next to the code raising them.
 */
export const BTN = {
  /* expense card — default mode */
  adjust: "☰ 調整",
  receipt: "⊕ 收據",
  delete: "⊗ 刪除",

  /* ☰ 調整 panel */
  payer: "誰付",
  who: "誰分",
  shares: "份數",
  currency: "幣別",
  amount: "± 金額",
  appEdit: "App 編輯",
  /** Closes the panel. Not "完成": every tap is already saved, nothing waits for this. */
  collapse: "← 收起",
  back: "← 返回",

  /* 誰分 */
  selectAll: "全選",
  onlyMe: "只有我",

  /* 份數 */
  resetShares: "重設為均分",

  /* 幣別 */
  otherCurrency: "其他…",

  /* entry points */
  openApp: "開啟揪帳",
  addToGroup: "⊕ 加到群組",
  howToSettle: "怎麼還",

  /* help site (src/app/help/**) */
  help: "使用說明",
  /** `/help`'s variant: the reply already *is* help, so the button offers the rest. */
  helpFull: "完整使用說明",

  /* /topic */
  topicClear: "↺ 改回 General",

  /* /unlink confirmation */
  confirmUnlink: "✗ 解除綁定",
  cancelUnlink: "取消",

  /* group deletion approval */
  approveDeleteGroup: "✓ 同意刪除",
  rejectDeleteGroup: "✗ 拒絕",
} as const;

/** `改發到「旅遊」` — the /topic button that moves notices into the topic it sits in. */
export const topicSetLabel = (topic: string) => `改發到「${topic}」`;

/** One person's 份數 buttons: `⊖ 小明` / `⊕ 小明`. */
export const sharesLessLabel = (name: string) => `⊖ ${name}`;
export const sharesMoreLabel = (name: string) => `⊕ ${name}`;

type Style = NonNullable<InlineKeyboardButton.AbstractInlineKeyboardButton["style"]>;
type Button = InlineKeyboardButton.AbstractInlineKeyboardButton;

/**
 * The colour of each button that has one. Red marks what deletes or detaches something;
 * blue marks the one button a message most wants pressed. Everything else keeps the
 * client's default. Green is never used: on 同意刪除 it would make a destructive action
 * look safe.
 */
const STYLE: Partial<Record<keyof typeof BTN, Style>> = {
  delete: "danger",
  confirmUnlink: "danger",
  approveDeleteGroup: "danger",
  openApp: "primary",
  addToGroup: "primary",
};

/** A button with its label and colour, for `InlineKeyboard.text/url/webApp`. */
export function button(key: keyof typeof BTN): Button {
  const style = STYLE[key];
  return style ? { text: BTN[key], style } : { text: BTN[key] };
}

/**
 * An option in a picker. The current choice is blue, so it stands out from the rest:
 * a multi-select (誰付 / 誰分) marks it ☑ / □, a single-select (幣別 / 時區) marks it ✓.
 */
export function choice(label: string, selected: boolean, kind: "multi" | "single"): Button {
  if (kind === "multi") {
    return selected ? { text: `☑︎ ${label}`, style: "primary" } : { text: `□ ${label}` };
  }
  return selected ? { text: `✓ ${label}`, style: "primary" } : { text: label };
}

/**
 * Callback-answer toasts that more than one handler raises.
 *
 * Only the shared ones live here. A toast raised from exactly one place stays
 * inline next to the condition it describes — a message you have to jump to
 * another file to read is worse than a repeated one, and this list earns its
 * keep only while every entry has two or more callers.
 */
export const TOAST = {
  unknownUser: "無法識別你的帳號，請再試一次",
  /** Covers a record deleted between rendering the card and pressing the button. */
  recordGone: "這筆紀錄已被刪除",
  requestGone: "此申請已不存在或已處理",
  notAMember: "你不是此群組的成員",
  actionFailed: "操作失敗，請再試一次",
  groupDeleted: "已同意，群組已刪除",
  staleButton: "這個按鈕已失效",
} as const;

/** The reply to a group-only command typed in a private chat. */
export const GROUP_ONLY = "這個指令要在群組裡用。";
