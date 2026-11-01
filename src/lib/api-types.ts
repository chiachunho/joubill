/**
 * Response shapes of the `/api/**` routes the two frontends read. One definition
 * here instead of one per page: the pages used to declare their own `MeResponse`,
 * `MembersResponse` and `AvatarsResponse`, and the copies had already drifted
 * apart (`status` optional in one, absent in another).
 *
 * Types only, so a client bundle can import it without pulling in the routes.
 */
import type { ActivityEntry } from "@/lib/record-history";
import type { BeancountConfigInput } from "@/lib/zod";

export type ActivityResponse = { entries: ActivityEntry[]; nextCursor: number | null };

export type MeResponse = {
  userId: number;
  groups: Array<{ id: number; title: string; defaultCurrency: string }>;
  /** Set by a Telegram deep link (startapp); always null on the web. */
  activeGroupId: number | null;
  activeExpenseId: number | null;
  activeSettlementId: number | null;
  /** Set by a `join_<code>` deep link; always null on the web. */
  activeInviteCode: string | null;
};

export type GroupPhotosResponse = { photos: Record<number, string | null> };

export type ProfileResponse = {
  /** The name the person chose; null = the provider's (`firstName` + `lastName`). */
  displayName: string | null;
  firstName: string;
  lastName: string | null;
  username: string | null;
  /** The picture `pickAvatar` resolved: the chosen source, else automatic. */
  photoUrl: string | null;
  /** `users.avatar_source`; null = automatic. */
  avatarSource: string | null;
  /** Linked login methods that have a picture, in the order automatic tries them. */
  avatarOptions: Array<{ source: string; url: string }>;
};

/** PATCH /api/me/profile. An omitted key is left unchanged; null resets it. */
export type ProfileUpdate = {
  displayName?: string | null;
  avatarSource?: string | null;
};

export type IdentitiesResponse = {
  /** Providers linked to this account. */
  linked: string[];
  /** Providers configured on this deployment (Telegram is always among them). */
  enabled: string[];
};

/** One side of `GET /api/me/merge`. */
export type AccountMergeSide = {
  userId: number;
  name: string;
  photoUrl: string | null;
  /** Login methods on this account. */
  providers: string[];
  groupCount: number;
  /** Expenses and settlements this account pays or owes in. */
  recordCount: number;
  /** The account the viewer is signed in as right now. */
  isCurrent: boolean;
};

export type AccountMergePreview = {
  /** The signed-in account first, then the one just proven by OAuth. */
  accounts: [AccountMergeSide, AccountMergeSide];
  /** Which account the page preselects to keep. */
  suggestedKeepId: number;
  /** Why these two can't be merged, or null when they can. */
  blocked: string | null;
  /** Groups both accounts are members of; they become one member there. */
  sharedGroups: { id: number; title: string }[];
  /** Groups the merged account will be in. */
  totalGroups: number;
  /** Settlements between the two accounts, which would read "A → A" afterwards. */
  selfSettlements: number;
};

export type Member = {
  id: number;
  displayName: string | null;
  firstName: string;
  lastName: string | null;
  username: string | null;
  status: string;
  /** Has a name but no account (added from the member list). */
  isPlaceholder: boolean;
};

export type MembersResponse = { members: Member[] };

export type SettingsResponse = { defaultCurrency: string };

export type AvatarsResponse = {
  groupPhoto: string | null;
  userPhotos: Record<number, string | null>;
};

export type ExpensePayer = {
  userId: number;
  displayName: string | null;
  firstName: string;
  lastName: string | null;
  username: string | null;
  amount: number;
};

export type ExpenseSplit = {
  debtorId: number;
  displayName: string | null;
  firstName: string;
  lastName: string | null;
  username: string | null;
  amount: number;
};

export type ExpenseListItem = {
  id: number;
  type: "expense" | "settlement";
  amount: number;
  currency: string;
  description: string | null;
  spentAt: string;
  payers: ExpensePayer[];
  splits: ExpenseSplit[];
};

export type ExpensesResponse = {
  expenses: ExpenseListItem[];
  /** Opaque cursor for the next (older) page; null on the last one. */
  nextCursor: string | null;
  /** Every record in the group, expenses and settlements; sent with the first page only. */
  total?: number | null;
};

export type BalanceResponse = {
  currency: string;
  balances: Array<{
    userId: number;
    amount: number;
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
  }>;
};

export type ExpenseDetail = {
  id: number;
  createdBy: number | null;
  createdAt: string | null;
  lastActivity: { actorId: number | null; at: string } | null;
  amount: number;
  currency: string;
  fxRate: number | null;
  fxQuote: string | null;
  description: string | null;
  payers: Array<{ payerId: number; amount: number }>;
  spentAt: string;
  receiptFileIds: string[];
  splits: Array<{
    debtorId: number;
    amount: number;
    shareType: string;
    splitValue: number | null;
  }>;
};

export type SettlementDetail = {
  id: number;
  createdBy: number | null;
  createdAt: string | null;
  lastActivity: { actorId: number | null; at: string } | null;
  amount: number;
  currency: string;
  fxRate: number | null;
  fxQuote: string | null;
  settledAt: string;
  from: { userId: number };
  to: { userId: number };
};

export type StatsResponse = {
  currency: string;
  selectedUserId: number;
  range: { key: string; from: string; to: string };
  monthly: Array<{ month: string; groupTotal: number; memberShare: number }>;
  netTrend: Array<{ date: string; net: number }>;
  byPayer: Array<{
    userId: number;
    displayName: string | null;
    firstName: string;
    lastName: string | null;
    username: string | null;
    total: number;
  }>;
};

export type RateRow = { id: number; base: string; quote: string; rate: number; updatedAt: string };
export type RatesResponse = { defaultCurrency: string; rates: RateRow[] };

export type EffectiveRateResponse = {
  rate: number | null;
  source: string | null;
  marketRate: number | null;
  /** Present only when the request asked for `counts`. */
  affectedExpenses?: number;
  affectedSettlements?: number;
};

/** Always filled in: an unsaved account comes back as its default. */
export type BeancountConfigResponse = { config: BeancountConfigInput };

export type BeancountExportSummary = {
  /** Records the file would hold. */
  included: number;
  /** Records in the range that don't touch the caller's ledger. */
  skipped: number;
  /** ISO; null = never exported, so 上次匯出後 means everything. */
  lastExportedAt: string | null;
  /** Whether 傳到我的私訊 can reach the caller at all. */
  telegramLinked: boolean;
};

export type DeleteRequestResponse = {
  request: {
    id: number;
    requestedBy: number;
    requestedByName: string;
    createdAt: string;
    expiresAt: string;
  } | null;
};

/** `DELETE /api/groups/[id]` either deletes at once or opens a request for the others to approve. */
export type DeleteGroupResponse = { ok?: boolean; pending?: boolean };

/** GET/POST /api/groups/[id]/invite */
/** `code` is null for a group that has not had one issued yet. */
export type InviteResponse = {
  code: string | null;
  /** The t.me link that opens the Mini App on this invite; null without a code or bot username. */
  miniLink: string | null;
};

/** POST /api/groups */
export type CreateGroupResponse = { id: number };

/** GET /api/invites/[code] */
export type InvitePreviewResponse = {
  groupId: number;
  title: string;
  memberCount: number;
  alreadyMember: boolean;
  /** Name-only members the visitor can claim; empty once they have joined. */
  placeholders: { id: number; name: string }[];
};

/** GET /api/groups/[id]/members/[userId]/merge */
export type MergePreviewResponse = {
  expenses: number;
  settlements: number;
  /** Of `settlements`, how many run between the two people and would read "A → A". */
  selfSettlements: number;
  /** The placeholder's net position per record currency (paid − owed). */
  net: Record<string, number>;
};

/** POST /api/invites/[code]/accept */
export type AcceptInviteResponse = { groupId: number };

/** GET /api/me/push-subscriptions */
export type PushSubscriptionsResponse = {
  /** False when the server has no VAPID keys: the 通知 section is hidden. */
  configured: boolean;
  /** How many of the caller's devices receive push. */
  count: number;
};

/** GET /api/groups/[id]/notifications */
export type GroupNotificationsResponse = {
  muted: boolean;
  /** The group has a Telegram chat, whose messages already tell its members what changed. */
  telegramLinked: boolean;
};
