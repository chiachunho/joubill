/**
 * What the rate field's placeholder says the empty field is using. The Expense and
 * Settlement forms both show it, so the wording lives here once. A market rate is
 * the rate of the record's own day.
 */
export function rateSourceLabel(effective: { source: string | null } | undefined): string {
  return effective?.source === "group" ? "群組自訂匯率" : "當日市場匯率";
}
