/**
 * Merging two real accounts into one (issue #99): someone who signed in with Google first
 * and only later found their Telegram account, which already has the groups.
 *
 * Pure — no DB — so the decisions are unit-tested. The transaction lives in
 * `src/lib/account-merge-db.ts`; the payer/split arithmetic is `planMerge` from
 * `member-merge.ts`, shared with claiming a placeholder.
 *
 * Proof of ownership: the person is signed in as one account and has just completed an
 * OAuth sign-in that belongs to the other. The Auth.js `signIn` callback records that as a
 * ticket whose id rides in an httpOnly cookie; nothing else can start a merge.
 */
import { isLoginProvider, PROVIDER_LABEL } from "@/lib/identities";

export const MERGE_TICKET_COOKIE = "merge_ticket";
/** The cookie is only sent to the merge API, never to pages or other routes. */
export const MERGE_TICKET_PATH = "/api/me/merge";
export const MERGE_TICKET_TTL_SECONDS = 600;
/** The one answer for a ticket that is missing, expired, used or someone else's. */
export const MERGE_TICKET_NOT_FOUND = "合併已逾時，請再連結一次。";

export type MergeIdentity = { provider: string; providerUid: string };

export type MergeAccount = {
  id: number;
  telegramId: number | null;
  placeholderGroupId: number | null;
  identities: MergeIdentity[];
};

export type AccountMergeCheck = { ok: true } | { ok: false; error: string };

/**
 * Whether two accounts can become one. `users.telegram_id` is unique and is how the bot and
 * the Mini App find a person, so two different Telegram ids can't share a row. The same goes
 * for two different accounts of one provider: the settings page treats a provider as linked
 * or not, and unlinking one would take both.
 */
export function validateAccountMerge(
  a: MergeAccount | undefined,
  b: MergeAccount | undefined,
): AccountMergeCheck {
  if (!a || !b || a.id === b.id) return { ok: false, error: "無法合併這兩個帳號。" };
  if (a.placeholderGroupId !== null || b.placeholderGroupId !== null) {
    return { ok: false, error: "無法合併這兩個帳號。" };
  }
  if (a.telegramId !== null && b.telegramId !== null && a.telegramId !== b.telegramId) {
    return {
      ok: false,
      error:
        "兩個帳號各自連結了不同的 Telegram 帳號。一個帳號只能對應一個 Telegram，所以無法合併。",
    };
  }
  for (const ia of a.identities) {
    const clash = b.identities.find(
      (ib) => ib.provider === ia.provider && ib.providerUid !== ia.providerUid,
    );
    if (clash) {
      const label = isLoginProvider(ia.provider) ? PROVIDER_LABEL[ia.provider] : ia.provider;
      return {
        ok: false,
        error: `兩個帳號各自連結了不同的 ${label} 帳號。請先在其中一邊解除 ${label} 的連結，再合併。`,
      };
    }
  }
  return { ok: true };
}

export type KeepCandidate = {
  id: number;
  telegramId: number | null;
  recordCount: number;
  createdAt: Date;
};

/**
 * Which account the confirm page preselects. The one holding the Telegram id first, since
 * the bot and Mini App already know that person; then the one with more records; then the
 * older one. The person may still pick the other: the data ends up the same either way,
 * only the name, photo and email on top differ.
 */
export function suggestKeep(a: KeepCandidate, b: KeepCandidate): number {
  if ((a.telegramId === null) !== (b.telegramId === null)) {
    return a.telegramId !== null ? a.id : b.id;
  }
  if (a.recordCount !== b.recordCount) return a.recordCount > b.recordCount ? a.id : b.id;
  return a.createdAt.getTime() <= b.createdAt.getTime() ? a.id : b.id;
}

export type MergeProfile = {
  telegramId: number | null;
  email: string | null;
  avatarUrl: string | null;
  username: string | null;
  lastName: string | null;
  languageCode: string | null;
  displayName: string | null;
  avatarSource: string | null;
};

const FILLABLE = [
  "telegramId",
  "email",
  "avatarUrl",
  "username",
  "lastName",
  "languageCode",
  // A chosen name or avatar source carries over when the kept account has none. The absorbed
  // account's identities move to the kept one, so its avatar source stays meaningful.
  "displayName",
  "avatarSource",
] as const;

/**
 * The columns the kept account takes from the absorbed one: only those it has nothing in.
 * The kept account's own values always win. `firstName` is never null, so it never moves.
 */
export function mergedProfileFields(
  keep: MergeProfile,
  absorb: MergeProfile,
): Partial<MergeProfile> {
  const out: Partial<MergeProfile> = {};
  for (const key of FILLABLE) {
    if (keep[key] === null && absorb[key] !== null) {
      (out as Record<string, unknown>)[key] = absorb[key];
    }
  }
  return out;
}

export type MembershipRow = { groupId: number; status: string };

export type MembershipPlan = {
  /** Groups only the absorbed account is in: its row is repointed, status and all. */
  repoint: number[];
  /** Groups both are in where the kept row is inactive but the absorbed one is active. */
  activate: number[];
  /** Groups both are in: the absorbed row is deleted (after `activate`). */
  drop: number[];
};

/** Both in a group → one row, active if either was (`group_members` keys on group + user). */
export function planMembership(keep: MembershipRow[], absorb: MembershipRow[]): MembershipPlan {
  const kept = new Map(keep.map((r) => [r.groupId, r.status]));
  const plan: MembershipPlan = { repoint: [], activate: [], drop: [] };
  for (const row of absorb) {
    const status = kept.get(row.groupId);
    if (status === undefined) {
      plan.repoint.push(row.groupId);
      continue;
    }
    plan.drop.push(row.groupId);
    if (status !== "active" && row.status === "active") plan.activate.push(row.groupId);
  }
  for (const list of [plan.repoint, plan.activate, plan.drop]) list.sort((x, y) => x - y);
  return plan;
}

export type BeancountConfigRow = { id: number; groupId: number };

/**
 * `user_beancount_configs` is unique per (user, group). Where only the absorbed account has
 * one it moves over; where both do, the kept account's own setup wins.
 */
export function planBeancountConfigs(
  keep: BeancountConfigRow[],
  absorb: BeancountConfigRow[],
): { repoint: number[]; drop: number[] } {
  const keptGroups = new Set(keep.map((c) => c.groupId));
  const repoint: number[] = [];
  const drop: number[] = [];
  for (const c of absorb) (keptGroups.has(c.groupId) ? drop : repoint).push(c.id);
  return { repoint: repoint.sort((x, y) => x - y), drop: drop.sort((x, y) => x - y) };
}
