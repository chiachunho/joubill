/**
 * The home page's group list (issue #179): how it is sorted, how a group's last update reads,
 * and how a balance is worded. Pure, so the bot's private `/balance` and both front ends word a
 * balance the same way.
 */

/** How the group list is ordered; remembered per device. */
export type GroupSort = "recent" | "name";

export const GROUP_SORTS: ReadonlyArray<{ value: GroupSort; label: string }> = [
  { value: "recent", label: "最近更新" },
  { value: "name", label: "名稱" },
];

/** `localStorage` key for the chosen order. */
export const GROUP_SORT_KEY = "joubill:groupSort";

/** A stored value back into a sort; anything unknown (or nothing stored) is the default. */
export function parseGroupSort(raw: string | null | undefined): GroupSort {
  return raw === "name" ? "name" : "recent";
}

type Sortable = { id: number; title: string; lastActivityAt: string };

const collator = new Intl.Collator("zh-Hant");

/**
 * The list in the chosen order, as a new array. `recent` is newest activity first; `name` is
 * zh-Hant collation. Ties fall back to the other key and then the id, so the order never
 * depends on what the database happened to return.
 */
export function sortGroups<T extends Sortable>(groups: readonly T[], sort: GroupSort): T[] {
  const byName = (a: T, b: T) => collator.compare(a.title, b.title);
  const byRecent = (a: T, b: T) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
  const [first, second] = sort === "name" ? [byName, byRecent] : [byRecent, byName];
  return [...groups].sort((a, b) => first(a, b) || second(a, b) || a.id - b.id);
}

/**
 * When a group last changed, for its row: "剛剛更新", "5 分鐘前更新", "3 小時前更新", "昨天更新",
 * "3 天前更新", then the date ("11/2 更新", with the year when it isn't this year's).
 */
export function updatedLabel(at: string, now: Date = new Date()): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const minutes = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (minutes < 1) return "剛剛更新";
  if (minutes < 60) return `${minutes} 分鐘前更新`;
  if (minutes < 24 * 60 && d.getDate() === now.getDate()) {
    return `${Math.floor(minutes / 60)} 小時前更新`;
  }
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(d)) / 86_400_000);
  if (days <= 1) return "昨天更新";
  if (days < 7) return `${days} 天前更新`;
  const day = `${d.getMonth() + 1}/${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? `${day} 更新` : `${d.getFullYear()}/${day} 更新`;
}

export type Standing = "receive" | "pay" | "settled";

/**
 * Where a person stands in a group, from their net balance (positive = others owe them).
 * Anything under a cent is settled, like `computeGroupBalances`, which drops it.
 */
export function standingOf(amount: number): Standing {
  if (Math.abs(amount) < 0.005) return "settled";
  return amount > 0 ? "receive" : "pay";
}

/** 應收 / 應付 / 已結清: the bot's private `/balance` and the group list say it the same way. */
export const STANDING_LABEL: Record<Standing, string> = {
  receive: "應收",
  pay: "應付",
  settled: "已結清",
};
