export function fmt(amount: number): string {
  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function monthLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * When something was recorded or changed: "7/25 20:14", with the year added
 * only when it isn't the current one.
 *
 * Shared by both attribution lines on the record forms and by the activity
 * views, so "由 X 於 … 記錄" and "最後由 Y 於 … 修改" read as one pair rather
 * than two differently formatted sentences.
 */
export function stampLabel(value: string | Date, now: Date = new Date()): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = `${d.getMonth() + 1}/${d.getDate()}`;
  return d.getFullYear() === now.getFullYear()
    ? `${day} ${time}`
    : `${d.getFullYear()}/${day} ${time}`;
}

/** Day heading for a grouped activity list: "今天", "昨天", or "7月25日". */
export function dayLabel(value: string | Date, now: Date = new Date()): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(d)) / 86_400_000);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  const prefix = d.getFullYear() === now.getFullYear() ? "" : `${d.getFullYear()}年`;
  return `${prefix}${d.getMonth() + 1}月${d.getDate()}日`;
}
