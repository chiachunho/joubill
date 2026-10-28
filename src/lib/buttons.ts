/**
 * Inline-keyboard button labels, in one place.
 *
 * The same button is rendered from more than one file: 🔗 App 編輯 and 🗑 刪除 sit
 * on both the expense card (`src/bot/expenseCard.ts`) and the settlement notice
 * (`src/lib/notify.ts`), and 開啟揪帳 is posted by five different commands.
 * Wording that drifts between those call sites reads as two different features,
 * and the card/notice pair in particular has to match — they are the same button
 * on two renderings of the same kind of record.
 *
 * Scope is deliberately *button labels only*. `answerCallbackQuery` toasts and
 * message bodies are not buttons: they are one-off sentences that belong next to
 * the code raising them, and hauling them in here would turn this into a
 * translation table nobody reads.
 */
export const BTN = {
  /* expense card — default mode */
  adjust: "⚙️ 調整",
  receipt: "🧾 收據",
  delete: "🗑 刪除",

  /* ⚙️ 調整 panel */
  payer: "💳 誰付",
  who: "👥 誰分",
  shares: "⚖️ 份數",
  currency: "💱 幣別",
  amount: "✏️ 金額",
  appEdit: "🔗 App 編輯",
  done: "← 完成",
  back: "← 返回",

  /* 👥 誰分 */
  selectAll: "全選",
  onlyMe: "只有我",

  /* ⚖️ 份數 */
  resetShares: "重設為均分",

  /* 💱 幣別 */
  otherCurrency: "其他…",

  /* Mini App entry points */
  openApp: "開啟揪帳",
  /** `/join`'s variant: it trails a sentence, so the arrow reads as "go here". */
  openAppArrow: "開啟揪帳 →",

  /* help site (src/app/help/**) */
  help: "📖 使用說明",
  /** `/help`'s variant: the reply already *is* help, so the button offers the rest. */
  helpFull: "📖 完整使用說明",

  /* group deletion approval */
  approveDeleteGroup: "✓ 同意刪除",
  rejectDeleteGroup: "✗ 拒絕",
} as const;

/**
 * Callback-answer toasts that more than one handler raises.
 *
 * Only the shared ones live here. A toast raised from exactly one place stays
 * inline next to the condition it describes — a message you have to jump to
 * another file to read is worse than a repeated one, and this list earns its
 * keep only while every entry has two or more callers.
 */
export const TOAST = {
  unknownUser: "無法識別使用者",
  /** Covers a record deleted between rendering the card and pressing the button. */
  recordGone: "找不到這筆紀錄（可能已刪除）",
  requestGone: "此申請已不存在或已處理",
  notAMember: "你不是此群組的成員",
  actionFailed: "操作失敗，請再試一次",
  groupDeleted: "已同意，群組已刪除",
} as const;
