import { connectionStatus } from "@/lib/agent-connection-input";
import type { AgentConnectionItem } from "@/lib/api-types";
import { dayLabel } from "@/lib/format";

/** The wording of the two permission levels, in one place for the list, the forms and the tests. */
export const ACCESS_LABEL = { read: "唯讀", write: "可記帳" } as const;

export const ACCESS_HINT = {
  read: "查看群組、餘額和紀錄",
  write: "再加上新增、編輯、刪除紀錄與還款",
} as const;

/** The expiry choices of 建立個人權杖; `null` never expires. 90 days is what the form starts on. */
export const EXPIRY_CHOICES: { days: number | null; label: string }[] = [
  { days: 30, label: "30 天" },
  { days: 90, label: "90 天" },
  { days: null, label: "不過期" },
];
export const DEFAULT_EXPIRY_DAYS = 90;

/** Connections that still work. A revoked one stays in the database for the audit log only. */
export function usableConnections(list: AgentConnectionItem[], now: Date = new Date()) {
  return list.filter((c) => connectionStatus(c, now) !== "revoked");
}

/** Connections that can be used right now: what the count on 個人設定 shows. */
export function activeConnections(list: AgentConnectionItem[], now: Date = new Date()) {
  return list.filter((c) => connectionStatus(c, now) === "active");
}

/**
 * Which groups a connection reaches, as text. A group the owner has since left is left out:
 * the connection can't reach it either (membership is checked on every call).
 */
export function scopeSummary(
  c: Pick<AgentConnectionItem, "allGroups" | "groupIds">,
  groups: { id: number; title: string }[],
): string {
  if (c.allGroups) return "所有群組";
  const titles = groups.filter((g) => c.groupIds.includes(g.id)).map((g) => g.title);
  return titles.length > 0 ? titles.join("、") : "沒有可用的群組";
}

/** "剛剛", "5 分鐘前", "3 小時前", then the day. */
export function lastUsedLabel(lastUsedAt: string | null, now: Date = new Date()): string {
  if (!lastUsedAt) return "從未使用";
  const minutes = Math.floor((now.getTime() - new Date(lastUsedAt).getTime()) / 60_000);
  if (minutes < 1) return "剛剛使用";
  if (minutes < 60) return `${minutes} 分鐘前使用`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 小時前使用`;
  return `${dayLabel(lastUsedAt, now)}使用`;
}

/** "30 天後到期" / "已到期" / "不過期". */
export function expiryLabel(expiresAt: string | null, now: Date = new Date()): string {
  if (!expiresAt) return "不過期";
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (ms <= 0) return "已到期";
  return `${Math.ceil(ms / 86_400_000)} 天後到期`;
}

/** The group ids a form has ticked, in a stable order, for comparing against what is saved. */
export function sameScope(
  a: { allGroups: boolean; groupIds: number[] },
  b: { allGroups: boolean; groupIds: number[] },
): boolean {
  if (a.allGroups || b.allGroups) return a.allGroups === b.allGroups;
  const x = [...a.groupIds].sort((p, q) => p - q);
  const y = [...b.groupIds].sort((p, q) => p - q);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** "透過 Claude": how every surface says a record came from an AI assistant. */
export function viaText(name: string): string {
  return `透過 ${name}`;
}
