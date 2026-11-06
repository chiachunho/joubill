/**
 * Which rate the form's 「≈」 line and the rate field's placeholder are using, in
 * words. The Expense and Settlement forms both show it, so the wording lives here
 * once. A market rate is the rate of the record's own day.
 */
export function rateSourceLabel(
  usingCustom: boolean,
  effective: { source: string | null } | undefined,
): string {
  if (usingCustom) return "此筆自訂匯率";
  if (effective?.source === "group") return "群組自訂匯率";
  return "當日匯率";
}
