/**
 * Which rate the form's 「≈」 line is using, in words. The Expense and Settlement
 * forms both show it, so the wording lives here once. A market rate names the day
 * it is from, which can trail the record's date (the API answers a weekend with
 * Friday's rate).
 */
export function rateSourceLabel(
  usingCustom: boolean,
  effective: { source: string | null; marketRateDate?: string | null } | undefined,
): string {
  if (usingCustom) return "此筆自訂匯率";
  if (effective?.source === "group") return "群組自訂匯率";
  const day = effective?.marketRateDate;
  return day ? `市場匯率 · ${day.replaceAll("-", "/")}` : "市場匯率";
}
