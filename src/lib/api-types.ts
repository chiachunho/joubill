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
};

export type GroupPhotosResponse = { photos: Record<number, string | null> };

export type ProfileResponse = {
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
};

export type Member = {
  id: number;
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
  firstName: string;
  lastName: string | null;
  username: string | null;
  amount: number;
};

export type ExpenseSplit = {
  debtorId: number;
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

export type BeancountConfigResponse = { config: BeancountConfigInput | null };

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
