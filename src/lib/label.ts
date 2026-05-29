export type Profile = {
  userId?: number;
  firstName: string | null;
  lastName?: string | null;
  username: string | null;
};

/** Format a display name, optionally replacing the current user with "你". */
export function labelUser(p: Profile | null, selfUserId?: number): string {
  if (!p) return "?";
  if (selfUserId !== undefined && p.userId === selfUserId) return "你";
  const full = [p.firstName, p.lastName].filter(Boolean).join(" ");
  return full || (p.username ? "@" + p.username : "?");
}

/**
 * Format a member name for dropdown selects. Shows "@username" in parentheses
 * when present so same-first-name members can be distinguished.
 */
export function labelMember(m: {
  firstName: string | null;
  lastName?: string | null;
  username: string | null;
}): string {
  const full = [m.firstName, m.lastName].filter(Boolean).join(" ");
  if (m.username) return full ? `${full} (@${m.username})` : `@${m.username}`;
  return full || "?";
}
