import { displayName, providerName } from "@/lib/profile";

export type Profile = {
  userId?: number;
  /** `users.display_name`. Required so a query that forgets to select it fails to compile
   *  instead of quietly showing the provider's name (issue #101). */
  displayName: string | null;
  firstName: string | null;
  lastName?: string | null;
  username: string | null;
};

/** How a record's creator or editor reads once they are no longer in the group's member list. */
export const FORMER_MEMBER = "已不在群組的成員";

/** Format a display name, optionally replacing the current user with "你". */
export function labelUser(p: Profile | null, selfUserId?: number): string {
  if (!p) return "?";
  if (selfUserId !== undefined && p.userId === selfUserId) return "你";
  return displayName(p) || "?";
}

/**
 * Format a member name for dropdown selects. Shows "@username" in parentheses
 * when present so same-first-name members can be distinguished.
 */
export function labelMember(m: {
  displayName: string | null;
  firstName: string | null;
  lastName?: string | null;
  username: string | null;
}): string {
  const full = m.displayName?.trim() || providerName(m);
  if (m.username) return full ? `${full} (@${m.username})` : `@${m.username}`;
  return full || "?";
}

/**
 * `labelMember` for a whole list, telling apart members whose labels collide. A display name
 * is the person's free choice and isn't unique, so two members can read the same; without a
 * username to show, a picker would offer two identical rows. The tie-break is the provider's
 * name when it differs, then the member's position in the list.
 */
export function memberLabels<
  M extends {
    id: number;
    displayName: string | null;
    firstName: string | null;
    lastName?: string | null;
    username: string | null;
  },
>(members: readonly M[]): Map<number, string> {
  const base = new Map(members.map((m) => [m.id, labelMember(m)]));
  const counts = new Map<string, number>();
  for (const label of base.values()) counts.set(label, (counts.get(label) ?? 0) + 1);

  // First tie-break: the provider's name. Two members can share that too (same chosen name,
  // same provider name), so whatever still collides after it is numbered instead.
  const tentative = new Map<number, string>();
  for (const m of members) {
    const label = base.get(m.id)!;
    const chosen = m.displayName?.trim();
    const provider = providerName(m);
    tentative.set(
      m.id,
      counts.get(label)! >= 2 && chosen && provider && provider !== chosen
        ? `${label}（${provider}）`
        : label,
    );
  }
  const tentativeCounts = new Map<string, number>();
  for (const label of tentative.values()) {
    tentativeCounts.set(label, (tentativeCounts.get(label) ?? 0) + 1);
  }

  const out = new Map<number, string>();
  const seen = new Map<string, number>();
  for (const m of members) {
    const label = tentative.get(m.id)!;
    if (tentativeCounts.get(label)! < 2) {
      out.set(m.id, label);
      continue;
    }
    const nth = (seen.get(label) ?? 0) + 1;
    seen.set(label, nth);
    out.set(m.id, `${label} #${nth}`);
  }
  return out;
}
