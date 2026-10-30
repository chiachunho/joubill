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

  const out = new Map<number, string>();
  const seen = new Map<string, number>();
  for (const m of members) {
    const label = base.get(m.id)!;
    if (counts.get(label)! < 2) {
      out.set(m.id, label);
      continue;
    }
    const chosen = m.displayName?.trim();
    const provider = providerName(m);
    const nth = (seen.get(label) ?? 0) + 1;
    seen.set(label, nth);
    out.set(
      m.id,
      chosen && provider && provider !== chosen ? `${label}（${provider}）` : `${label} #${nth}`,
    );
  }
  return out;
}
