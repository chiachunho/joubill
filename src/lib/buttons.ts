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

  /* group deletion approval */
  approveDeleteGroup: "✓ 同意刪除",
  rejectDeleteGroup: "✗ 拒絕",
} as const;
