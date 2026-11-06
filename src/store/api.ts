import { createApi } from "@reduxjs/toolkit/query/react";

import type {
  AccountMergePreview,
  McpConnectionItem,
  McpConnectionsResponse,
  CreateMcpConnectionResponse,
  AcceptInviteResponse,
  ActivityResponse,
  AvatarsResponse,
  BalanceResponse,
  BeancountConfigResponse,
  BeancountExportSummary,
  CreateGroupResponse,
  DeleteGroupResponse,
  DeleteRequestResponse,
  EffectiveRateResponse,
  ExpenseDetail,
  ExpensesResponse,
  GroupChatResponse,
  GroupNotificationsResponse,
  GroupPhotosResponse,
  InvitePreviewResponse,
  InviteResponse,
  MeResponse,
  MergePreviewResponse,
  MembersResponse,
  ProfileResponse,
  ProfileUpdate,
  PushSubscriptionsResponse,
  IdentitiesResponse,
  RatesResponse,
  SettingsResponse,
  SettlementDetail,
  StatsResponse,
} from "@/lib/api-types";
import type { ActivitySource } from "@/lib/activity-source";
import type { CreateConnectionInput, UpdateConnectionInput } from "@/lib/mcp-connection-input";
import type { BeancountConfigInput } from "@/lib/zod";

import { apiBaseQuery } from "./base-query";

/** A group id as it appears in a URL or a page param; the cache tags normalise it to a string. */
export type GroupId = string | number;

const g = (groupId: GroupId) => String(groupId);

/**
 * Tag types, and what each one means. Every record mutation names the tags it
 * touches here instead of every form carrying its own list of keys to refresh:
 * that list used to be copied into three components, and a key left out of one
 * copy meant a page quietly showing numbers from before the edit.
 *
 * Group-scoped tags carry the group id. `Expense` / `Settlement` carry
 * `<groupId>` for "every record of that group" (a rate change touches all of
 * their converted amounts) and `<groupId>:<recordId>` for one record's detail.
 */
const tagTypes = [
  "Me",
  "Profile",
  "Identities",
  "McpConnections",
  "GroupPhotos",
  "Members",
  "Settings",
  "Avatars",
  "Expenses",
  "Expense",
  "Settlement",
  "Balance",
  "Stats",
  "Activity",
  "Rates",
  "EffectiveRate",
  "Beancount",
  "BeancountExport",
  "DeleteRequest",
  "Invite",
  "PushSubscriptions",
  "GroupNotifications",
  "GroupChat",
] as const;

type Tag = { type: (typeof tagTypes)[number]; id: string };

const tag = (type: Tag["type"], id: string): Tag => ({ type, id });

/**
 * Every cached read that shows a person's name or picture, in every group (a bare type
 * invalidates all of its ids). A profile change reaches all of a person's groups at once, and
 * the viewer can't know which groups' caches hold them, so this is deliberately wide.
 */
const peopleTags = [
  "Members",
  "Avatars",
  "Expenses",
  "Balance",
  "Stats",
  "Activity",
  "DeleteRequest",
] as const satisfies readonly Tag["type"][];

/** What any create / edit / delete of an expense or settlement changes. */
function ledgerTags(groupId: GroupId): Tag[] {
  return [
    tag("Expenses", g(groupId)),
    tag("Balance", g(groupId)),
    tag("Stats", g(groupId)),
    tag("Activity", g(groupId)),
    tag("BeancountExport", g(groupId)),
  ];
}

/**
 * Balances, stats and every record's converted amount are derived from the
 * group's rates and default currency, so a change to either refreshes all of it.
 */
function derivedFromRatesTags(groupId: GroupId): Tag[] {
  return [
    ...ledgerTags(groupId),
    tag("Expense", g(groupId)),
    tag("Settlement", g(groupId)),
    tag("Rates", g(groupId)),
    tag("EffectiveRate", g(groupId)),
  ];
}

const baseApi = createApi({
  reducerPath: "api",
  baseQuery: apiBaseQuery,
  tagTypes,
  // Show what is cached and refetch behind it when the data is older than 5 s: the
  // stale-while-revalidate behaviour the app had before RTK Query (5 s dedupe window).
  refetchOnMountOrArgChange: 5,
  // The old cache never expired within a session, so coming back to a page was instant.
  keepUnusedDataFor: 300,
  endpoints: (build) => ({
    // ---- reads ----------------------------------------------------------------
    getMe: build.query<MeResponse, void>({
      query: () => ({ url: "/api/me/groups" }),
      providesTags: [tag("Me", "LIST")],
    }),
    getGroupPhotos: build.query<GroupPhotosResponse, void>({
      query: () => ({ url: "/api/me/groups/photos" }),
      providesTags: [tag("GroupPhotos", "LIST")],
    }),
    getInvite: build.query<InviteResponse, GroupId>({
      query: (groupId) => ({ url: `/api/groups/${groupId}/invite` }),
      providesTags: (_r, _e, groupId) => [tag("Invite", g(groupId))],
    }),
    getInvitePreview: build.query<InvitePreviewResponse, string>({
      query: (code) => ({ url: `/api/invites/${encodeURIComponent(code)}` }),
    }),
    getProfile: build.query<ProfileResponse, void>({
      query: () => ({ url: "/api/me/profile" }),
      providesTags: [tag("Profile", "ME")],
    }),
    getIdentities: build.query<IdentitiesResponse, void>({
      query: () => ({ url: "/api/me/identities" }),
      providesTags: [tag("Identities", "ME")],
    }),
    getMcpConnections: build.query<McpConnectionsResponse, void>({
      query: () => ({ url: "/api/me/mcp-connections" }),
      providesTags: [tag("McpConnections", "ME")],
    }),
    // The ticket rides in an httpOnly cookie; this is read once, on the confirm page.
    getAccountMergePreview: build.query<AccountMergePreview, void>({
      query: () => ({ url: "/api/me/merge" }),
      keepUnusedDataFor: 0,
    }),
    getMembers: build.query<MembersResponse, GroupId>({
      query: (groupId) => ({ url: `/api/groups/${groupId}/members` }),
      providesTags: (_r, _e, groupId) => [tag("Members", g(groupId))],
    }),
    getSettings: build.query<SettingsResponse, GroupId>({
      query: (groupId) => ({ url: `/api/groups/${groupId}/settings` }),
      providesTags: (_r, _e, groupId) => [tag("Settings", g(groupId))],
    }),
    getAvatars: build.query<AvatarsResponse, GroupId>({
      query: (groupId) => ({ url: `/api/groups/${groupId}/avatars` }),
      providesTags: (_r, _e, groupId) => [tag("Avatars", g(groupId))],
    }),
    /**
     * The group's records, newest first, a page at a time behind a `(spent_at, id)`
     * cursor. Invalidating `Expenses` refetches every loaded page, so an edit to a
     * row on page 2 shows up without the list resetting to page 1.
     */
    getExpenses: build.infiniteQuery<
      ExpensesResponse,
      GroupId,
      /** The `nextCursor` of the page before; "" for the first page. */
      string
    >({
      infiniteQueryOptions: {
        initialPageParam: "",
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
      query: ({ queryArg: groupId, pageParam }) => ({
        url: `/api/groups/${groupId}/expenses${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
      }),
      providesTags: (_r, _e, groupId) => [tag("Expenses", g(groupId))],
    }),
    getBalance: build.query<BalanceResponse, GroupId>({
      query: (groupId) => ({ url: `/api/groups/${groupId}/balance` }),
      providesTags: (_r, _e, groupId) => [tag("Balance", g(groupId))],
    }),
    getExpense: build.query<ExpenseDetail, { groupId: GroupId; expenseId: number }>({
      query: ({ groupId, expenseId }) => ({ url: `/api/groups/${groupId}/expenses/${expenseId}` }),
      providesTags: (_r, _e, { groupId, expenseId }) => [
        tag("Expense", g(groupId)),
        tag("Expense", `${groupId}:${expenseId}`),
      ],
    }),
    getSettlement: build.query<SettlementDetail, { groupId: GroupId; settlementId: number }>({
      query: ({ groupId, settlementId }) => ({
        url: `/api/groups/${groupId}/settlements/${settlementId}`,
      }),
      providesTags: (_r, _e, { groupId, settlementId }) => [
        tag("Settlement", g(groupId)),
        tag("Settlement", `${groupId}:${settlementId}`),
      ],
    }),
    getStats: build.query<
      StatsResponse,
      {
        groupId: GroupId;
        /** The member being viewed; the caller when omitted. */
        userId?: number;
        range: string;
        /** Full ISO instants, required for `range: "custom"`. */
        from?: string;
        to?: string;
      }
    >({
      query: ({ groupId, userId, range, from, to }) => {
        const qs = new URLSearchParams();
        if (userId !== undefined) qs.set("userId", String(userId));
        qs.set("range", range);
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);
        return { url: `/api/groups/${groupId}/stats?${qs.toString()}` };
      },
      providesTags: (_r, _e, { groupId }) => [tag("Stats", g(groupId))],
    }),
    getRates: build.query<RatesResponse, GroupId>({
      query: (groupId) => ({ url: `/api/groups/${groupId}/rates` }),
      providesTags: (_r, _e, groupId) => [tag("Rates", g(groupId))],
    }),
    getEffectiveRate: build.query<
      EffectiveRateResponse,
      {
        groupId: GroupId;
        base: string;
        /** YYYY-MM-DD; today when omitted. */
        date?: string;
        /** Also count the existing records the rate would re-convert. */
        counts?: boolean;
      }
    >({
      query: ({ groupId, base, date, counts }) => {
        const qs = new URLSearchParams({ base });
        if (date) qs.set("date", date);
        if (counts) qs.set("counts", "1");
        return { url: `/api/groups/${groupId}/rates/effective?${qs.toString()}` };
      },
      providesTags: (_r, _e, { groupId }) => [tag("EffectiveRate", g(groupId))],
    }),
    getBeancountConfig: build.query<BeancountConfigResponse, GroupId>({
      query: (groupId) => ({ url: `/api/groups/${groupId}/beancount` }),
      providesTags: (_r, _e, groupId) => [tag("Beancount", g(groupId))],
    }),
    /**
     * What the beancount export would hold for a range (`beancountRangeParams`), plus the
     * watermark. Any record change touches it (it is in `ledgerTags`), and so does an export.
     */
    getBeancountExportSummary: build.query<
      BeancountExportSummary,
      { groupId: GroupId; params: Record<string, string> }
    >({
      query: ({ groupId, params }) => ({
        url: `/api/groups/${groupId}/beancount/export/summary?${new URLSearchParams(params).toString()}`,
      }),
      providesTags: (_r, _e, { groupId }) => [tag("BeancountExport", g(groupId))],
    }),
    getDeleteRequest: build.query<DeleteRequestResponse, GroupId>({
      query: (groupId) => ({ url: `/api/groups/${groupId}/delete-request` }),
      providesTags: (_r, _e, groupId) => [tag("DeleteRequest", g(groupId))],
    }),
    /**
     * The change log, a page at a time: the feed is capped per page, so without
     * paging everything older than the first page is unreachable. `recordId` narrows
     * it to one record's history, which is short and always comes back whole.
     */
    getActivity: build.infiniteQuery<
      ActivityResponse,
      { groupId: GroupId; recordId?: string | null; source?: ActivitySource },
      /** The `nextCursor` of the page before; 0 for the first page. */
      number
    >({
      infiniteQueryOptions: {
        initialPageParam: 0,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
      query: ({ queryArg: { groupId, recordId, source }, pageParam }) => {
        const params: string[] = [];
        if (source && source !== "all") params.push(`source=${source}`);
        if (recordId) params.push(`record=${recordId}`);
        if (pageParam) params.push(`cursor=${pageParam}`);
        return {
          url: `/api/groups/${groupId}/activity${params.length ? `?${params.join("&")}` : ""}`,
        };
      },
      providesTags: (_r, _e, { groupId }) => [tag("Activity", g(groupId))],
    }),

    // ---- expenses & settlements ------------------------------------------------
    createExpense: build.mutation<{ id: number }, { groupId: GroupId; body: unknown }>({
      query: ({ groupId, body }) => ({
        url: `/api/groups/${groupId}/expenses`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_r, _e, { groupId }) => ledgerTags(groupId),
    }),
    updateExpense: build.mutation<
      { ok: boolean },
      { groupId: GroupId; expenseId: number; body: unknown }
    >({
      query: ({ groupId, expenseId, body }) => ({
        url: `/api/groups/${groupId}/expenses/${expenseId}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (_r, _e, { groupId, expenseId }) => [
        ...ledgerTags(groupId),
        tag("Expense", `${groupId}:${expenseId}`),
      ],
    }),
    deleteExpense: build.mutation<{ ok: boolean }, { groupId: GroupId; expenseId: number }>({
      query: ({ groupId, expenseId }) => ({
        url: `/api/groups/${groupId}/expenses/${expenseId}`,
        method: "DELETE",
      }),
      // Not the record's own detail tag: its page is still mounted while the form navigates
      // away, and refetching a record that no longer exists would flash a 404 on the way out.
      invalidatesTags: (_r, _e, { groupId }) => ledgerTags(groupId),
    }),
    createSettlement: build.mutation<{ id: number }, { groupId: GroupId; body: unknown }>({
      query: ({ groupId, body }) => ({
        url: `/api/groups/${groupId}/settlements`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_r, _e, { groupId }) => ledgerTags(groupId),
    }),
    updateSettlement: build.mutation<
      { ok: boolean },
      { groupId: GroupId; settlementId: number; body: unknown }
    >({
      query: ({ groupId, settlementId, body }) => ({
        url: `/api/groups/${groupId}/settlements/${settlementId}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (_r, _e, { groupId, settlementId }) => [
        ...ledgerTags(groupId),
        tag("Settlement", `${groupId}:${settlementId}`),
      ],
    }),
    deleteSettlement: build.mutation<{ ok: boolean }, { groupId: GroupId; settlementId: number }>({
      query: ({ groupId, settlementId }) => ({
        url: `/api/groups/${groupId}/settlements/${settlementId}`,
        method: "DELETE",
      }),
      // Not the record's own detail tag, for the reason `deleteExpense` gives.
      invalidatesTags: (_r, _e, { groupId }) => ledgerTags(groupId),
    }),

    // ---- members -----------------------------------------------------------------
    addPlaceholderMember: build.mutation<unknown, { groupId: GroupId; firstName: string }>({
      query: ({ groupId, firstName }) => ({
        url: `/api/groups/${groupId}/members/placeholder`,
        method: "POST",
        body: { firstName },
      }),
      invalidatesTags: (_r, _e, { groupId }) => [tag("Members", g(groupId))],
    }),
    renameMember: build.mutation<unknown, { groupId: GroupId; userId: number; firstName: string }>({
      query: ({ groupId, userId, firstName }) => ({
        url: `/api/groups/${groupId}/members/${userId}`,
        method: "PATCH",
        body: { firstName },
      }),
      // The name is printed on every record, balance and log line it appears in.
      invalidatesTags: (_r, _e, { groupId }) => [
        tag("Members", g(groupId)),
        ...ledgerTags(groupId),
      ],
    }),
    // What claiming this placeholder would take. Not cached across opens: the dialog needs
    // the numbers as they are when it asks, and `Members` invalidation drops it anyway.
    getMergePreview: build.query<
      MergePreviewResponse,
      { groupId: GroupId; userId: number; intoUserId: number }
    >({
      query: ({ groupId, userId, intoUserId }) => ({
        url: `/api/groups/${groupId}/members/${userId}/merge?intoUserId=${intoUserId}`,
      }),
      keepUnusedDataFor: 0,
    }),
    mergeMember: build.mutation<
      { ok: true; recordCount: number; removed: number },
      {
        groupId: GroupId;
        userId: number;
        intoUserId: number;
        selfSettlements?: "delete" | "keep";
      }
    >({
      query: ({ groupId, userId, intoUserId, selfSettlements }) => ({
        url: `/api/groups/${groupId}/members/${userId}/merge`,
        method: "POST",
        body: { intoUserId, ...(selfSettlements ? { selfSettlements } : {}) },
      }),
      // Every record now names a different person; the placeholder is gone, and the log
      // gains a row. The beancount config's per-member accounts were re-keyed too.
      invalidatesTags: (_r, _e, { groupId }) => [
        tag("Members", g(groupId)),
        tag("Avatars", g(groupId)),
        tag("Expense", g(groupId)),
        tag("Settlement", g(groupId)),
        tag("Beancount", g(groupId)),
        ...ledgerTags(groupId),
      ],
    }),
    removeMember: build.mutation<unknown, { groupId: GroupId; userId: number }>({
      query: ({ groupId, userId }) => ({
        url: `/api/groups/${groupId}/members/${userId}`,
        method: "DELETE",
      }),
      invalidatesTags: (_r, _e, { groupId }) => [
        tag("Members", g(groupId)),
        tag("Avatars", g(groupId)),
      ],
    }),

    // ---- rates -------------------------------------------------------------------
    putRate: build.mutation<
      unknown,
      {
        groupId: GroupId;
        base: string;
        quote: string;
        rate: number;
        /** Pin every existing record at its current rate first, so only future ones change. */
        lockExisting: boolean;
      }
    >({
      query: ({ groupId, ...body }) => ({
        url: `/api/groups/${groupId}/rates`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (_r, _e, { groupId }) => derivedFromRatesTags(groupId),
    }),
    deleteRate: build.mutation<
      unknown,
      { groupId: GroupId; base: string; quote: string; lock: boolean }
    >({
      query: ({ groupId, base, quote, lock }) => ({
        url: `/api/groups/${groupId}/rates?base=${base}&quote=${quote}${lock ? "&lock=1" : ""}`,
        method: "DELETE",
      }),
      invalidatesTags: (_r, _e, { groupId }) => derivedFromRatesTags(groupId),
    }),

    // ---- login methods ---------------------------------------------------------------
    unlinkIdentity: build.mutation<unknown, { provider: string }>({
      query: ({ provider }) => ({
        url: `/api/me/identities/${encodeURIComponent(provider)}`,
        method: "DELETE",
      }),
      // Unlinking the login the avatar came from moves it back to automatic.
      invalidatesTags: [tag("Identities", "ME"), tag("Profile", "ME"), "Avatars"],
    }),

    // ---- AI assistants (issues #147, #150) ---------------------------------------------
    // The token in the response is shown once and kept in component state; the cache holds a
    // copy of it only until `keepUnusedDataFor`, so the caller calls `.unwrap()` and `reset()`.
    createMcpConnection: build.mutation<CreateMcpConnectionResponse, CreateConnectionInput>({
      query: (body) => ({ url: "/api/me/mcp-connections", method: "POST", body }),
      invalidatesTags: [tag("McpConnections", "ME")],
    }),
    updateMcpConnection: build.mutation<
      { connection: McpConnectionItem },
      { id: number } & UpdateConnectionInput
    >({
      query: ({ id, ...body }) => ({
        url: `/api/me/mcp-connections/${id}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: [tag("McpConnections", "ME")],
    }),
    revokeMcpConnection: build.mutation<unknown, { id: number }>({
      query: ({ id }) => ({ url: `/api/me/mcp-connections/${id}`, method: "DELETE" }),
      invalidatesTags: [tag("McpConnections", "ME")],
    }),

    updateProfile: build.mutation<ProfileResponse, ProfileUpdate>({
      query: (body) => ({ url: "/api/me/profile", method: "PATCH", body }),
      invalidatesTags: [tag("Profile", "ME"), ...peopleTags],
    }),
    // No tags: the page reloads after a merge, since the session may now be another user's.
    mergeAccounts: build.mutation<
      { ok: true; keptUserId: number; groups: number; records: number },
      { keepUserId: number; selfSettlements: "keep" | "delete" }
    >({
      query: (body) => ({ url: "/api/me/merge", method: "POST", body }),
    }),
    cancelAccountMerge: build.mutation<unknown, void>({
      query: () => ({ url: "/api/me/merge", method: "DELETE" }),
    }),

    // ---- push notifications (issue #67) ----------------------------------------------
    getPushSubscriptions: build.query<PushSubscriptionsResponse, void>({
      query: () => ({ url: "/api/me/push-subscriptions" }),
      providesTags: [tag("PushSubscriptions", "ME")],
    }),
    savePushSubscription: build.mutation<
      unknown,
      { endpoint: string; keys: { p256dh: string; auth: string } }
    >({
      query: (body) => ({ url: "/api/me/push-subscriptions", method: "POST", body }),
      invalidatesTags: [tag("PushSubscriptions", "ME")],
    }),
    deletePushSubscription: build.mutation<unknown, { endpoint: string }>({
      query: (body) => ({ url: "/api/me/push-subscriptions", method: "DELETE", body }),
      invalidatesTags: [tag("PushSubscriptions", "ME")],
    }),
    sendTestPush: build.mutation<unknown, { endpoint: string }>({
      query: (body) => ({ url: "/api/me/push-subscriptions/test", method: "POST", body }),
    }),
    getGroupChat: build.query<GroupChatResponse, GroupId>({
      query: (groupId) => ({ url: `/api/groups/${groupId}/chat` }),
      providesTags: (_r, _e, groupId) => [tag("GroupChat", g(groupId))],
    }),
    getGroupNotifications: build.query<GroupNotificationsResponse, GroupId>({
      query: (groupId) => ({ url: `/api/groups/${groupId}/notifications` }),
      providesTags: (_r, _e, groupId) => [tag("GroupNotifications", g(groupId))],
    }),

    // ---- creating and joining a group ------------------------------------------------
    createGroup: build.mutation<
      CreateGroupResponse,
      { title: string; defaultCurrency: string; timezone: string }
    >({
      query: (body) => ({ url: "/api/groups", method: "POST", body }),
      invalidatesTags: [tag("Me", "LIST"), tag("GroupPhotos", "LIST")],
    }),
    acceptInvite: build.mutation<
      AcceptInviteResponse,
      { code: string; placeholderUserId?: number }
    >({
      query: ({ code, placeholderUserId }) => ({
        url: `/api/invites/${encodeURIComponent(code)}/accept`,
        method: "POST",
        ...(placeholderUserId !== undefined ? { body: { placeholderUserId } } : {}),
      }),
      // A new member changes every group-scoped list that names members or splits them.
      invalidatesTags: (r) => [
        tag("Me", "LIST"),
        tag("GroupPhotos", "LIST"),
        ...(r
          ? [tag("Members", g(r.groupId)), ...ledgerTags(r.groupId), tag("Avatars", g(r.groupId))]
          : []),
      ],
    }),

    // ---- deleting a group ----------------------------------------------------------
    deleteGroup: build.mutation<DeleteGroupResponse, { groupId: GroupId }>({
      query: ({ groupId }) => ({ url: `/api/groups/${groupId}`, method: "DELETE" }),
      invalidatesTags: (_r, _e, { groupId }) => [
        tag("DeleteRequest", g(groupId)),
        tag("Me", "LIST"),
        tag("GroupPhotos", "LIST"),
      ],
    }),
    approveDeleteRequest: build.mutation<unknown, { groupId: GroupId }>({
      query: ({ groupId }) => ({ url: `/api/groups/${groupId}/delete-request`, method: "POST" }),
      invalidatesTags: (_r, _e, { groupId }) => [
        tag("DeleteRequest", g(groupId)),
        tag("Me", "LIST"),
        tag("GroupPhotos", "LIST"),
      ],
    }),
    cancelDeleteRequest: build.mutation<unknown, { groupId: GroupId }>({
      query: ({ groupId }) => ({ url: `/api/groups/${groupId}/delete-request`, method: "DELETE" }),
      invalidatesTags: (_r, _e, { groupId }) => [tag("DeleteRequest", g(groupId))],
    }),
  }),
});

/**
 * The edits that update the screen before the server answers, or write the server's
 * answer straight into the cache instead of waiting for a refetch. They sit in a
 * second `injectEndpoints` so they can reach `baseApi.util` without the api
 * having to name its own type while it is still being defined.
 */
export const api = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /** Flip a member between counted and not counted in splits. Rolled back if the server says no. */
    updateMemberStatus: build.mutation<
      unknown,
      { groupId: GroupId; userId: number; status: "active" | "inactive" }
    >({
      query: ({ groupId, userId, status }) => ({
        url: `/api/groups/${groupId}/members/${userId}`,
        method: "PATCH",
        body: { status },
      }),
      async onQueryStarted({ groupId, userId, status }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          baseApi.util.updateQueryData("getMembers", groupId, (draft) => {
            const member = draft.members.find((m) => m.id === userId);
            if (member) member.status = status;
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
    }),
    /**
     * Save the beancount accounts. The response is the saved config, written straight into
     * the cache so the page's "已儲存" baseline is the server's copy without a refetch.
     */
    putBeancountConfig: build.mutation<
      BeancountConfigResponse,
      { groupId: GroupId; config: BeancountConfigInput }
    >({
      query: ({ groupId, config }) => ({
        url: `/api/groups/${groupId}/beancount`,
        method: "PUT",
        body: config,
      }),
      async onQueryStarted({ groupId }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(baseApi.util.upsertQueryData("getBeancountConfig", groupId, data));
        } catch {
          // the page shows the error from the mutation itself
        }
      },
    }),
    /**
     * Issue the first invite code, or replace the live one. The response is the new code,
     * written straight into the cache: the old code is dead the moment the server answers,
     * so the panel must not keep offering it while a refetch runs (or after one fails).
     */
    resetInvite: build.mutation<InviteResponse, { groupId: GroupId }>({
      query: ({ groupId }) => ({ url: `/api/groups/${groupId}/invite`, method: "POST" }),
      // The feed gains an 重設了邀請碼 row; Invite still refetches for any reader keyed
      // on the other spelling of the group id (a number where this one is a string).
      invalidatesTags: (_r, _e, { groupId }) => [
        tag("Invite", g(groupId)),
        tag("Activity", g(groupId)),
      ],
      async onQueryStarted({ groupId }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(baseApi.util.upsertQueryData("getInvite", groupId, data));
        } catch {
          // the panel shows the error from the mutation itself; the old code is still live
        }
      },
    }),
    /**
     * Detach the group from its Telegram chat. Push is held back for groups with a chat (the chat
     * already says what changed), so the notifications read is stale too, and the feed gains a row.
     */
    unlinkChat: build.mutation<{ ok: true }, { groupId: GroupId }>({
      query: ({ groupId }) => ({ url: `/api/groups/${groupId}/chat`, method: "DELETE" }),
      invalidatesTags: (_r, _e, { groupId }) => [
        tag("GroupChat", g(groupId)),
        tag("GroupNotifications", g(groupId)),
        tag("Activity", g(groupId)),
      ],
    }),
    /** Post the beancount file to the caller's private chat with the bot; moves the watermark. */
    sendBeancountExport: build.mutation<
      { ok: true; included: number; corrected: number },
      { groupId: GroupId; params: Record<string, string> }
    >({
      query: ({ groupId, params }) => ({
        url: `/api/groups/${groupId}/beancount/export/send`,
        method: "POST",
        body: params,
      }),
      invalidatesTags: (_r, _e, { groupId }) => [tag("BeancountExport", g(groupId))],
    }),
    /** Mute or unmute push for one group. The switch flips at once and rolls back on failure. */
    updateGroupNotifications: build.mutation<
      { muted: boolean },
      { groupId: GroupId; muted: boolean }
    >({
      query: ({ groupId, muted }) => ({
        url: `/api/groups/${groupId}/notifications`,
        method: "PATCH",
        body: { muted },
      }),
      async onQueryStarted({ groupId, muted }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          baseApi.util.updateQueryData("getGroupNotifications", groupId, (draft) => {
            draft.muted = muted;
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
    }),
    /**
     * Change the group's default currency. Everything converted into it moves with it, so
     * the derived tags refresh; the settings entry itself already shows the new value.
     */
    updateGroupCurrency: build.mutation<
      SettingsResponse,
      { groupId: GroupId; defaultCurrency: string }
    >({
      query: ({ groupId, defaultCurrency }) => ({
        url: `/api/groups/${groupId}/settings`,
        method: "PATCH",
        body: { defaultCurrency },
      }),
      async onQueryStarted({ groupId, defaultCurrency }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          baseApi.util.updateQueryData("getSettings", groupId, (draft) => {
            draft.defaultCurrency = defaultCurrency;
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
      invalidatesTags: (_r, _e, { groupId }) => [
        ...derivedFromRatesTags(groupId),
        tag("Me", "LIST"),
      ],
    }),
    /**
     * Change the group's time zone. It moves no record (a record's date is a plain day); it
     * decides which day "now" is, so stats ranges and the activity feed refresh, and the
     * settings entry shows the new value at once.
     */
    updateGroupTimezone: build.mutation<SettingsResponse, { groupId: GroupId; timezone: string }>({
      query: ({ groupId, timezone }) => ({
        url: `/api/groups/${groupId}/settings`,
        method: "PATCH",
        body: { timezone },
      }),
      async onQueryStarted({ groupId, timezone }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          baseApi.util.updateQueryData("getSettings", groupId, (draft) => {
            draft.timezone = timezone;
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
      invalidatesTags: (_r, _e, { groupId }) => [
        tag("Settings", g(groupId)),
        ...ledgerTags(groupId),
      ],
    }),
  }),
});

export const {
  useGetMeQuery,
  useUpdateGroupTimezoneMutation,
  useGetGroupPhotosQuery,
  useGetInviteQuery,
  useGetInvitePreviewQuery,
  useGetProfileQuery,
  useUpdateProfileMutation,
  useGetMcpConnectionsQuery,
  useCreateMcpConnectionMutation,
  useUpdateMcpConnectionMutation,
  useRevokeMcpConnectionMutation,
  useGetIdentitiesQuery,
  useUnlinkIdentityMutation,
  useGetAccountMergePreviewQuery,
  useMergeAccountsMutation,
  useCancelAccountMergeMutation,
  useGetPushSubscriptionsQuery,
  useSavePushSubscriptionMutation,
  useDeletePushSubscriptionMutation,
  useSendTestPushMutation,
  useGetGroupChatQuery,
  useGetGroupNotificationsQuery,
  useUpdateGroupNotificationsMutation,
  useGetMembersQuery,
  useGetSettingsQuery,
  useGetAvatarsQuery,
  useGetExpensesInfiniteQuery,
  useGetBalanceQuery,
  useGetExpenseQuery,
  useGetSettlementQuery,
  useGetStatsQuery,
  useGetRatesQuery,
  useGetEffectiveRateQuery,
  useLazyGetEffectiveRateQuery,
  useGetBeancountConfigQuery,
  useGetBeancountExportSummaryQuery,
  useGetDeleteRequestQuery,
  useGetActivityInfiniteQuery,
  useCreateExpenseMutation,
  useUpdateExpenseMutation,
  useDeleteExpenseMutation,
  useCreateSettlementMutation,
  useUpdateSettlementMutation,
  useDeleteSettlementMutation,
  useAddPlaceholderMemberMutation,
  useRenameMemberMutation,
  useGetMergePreviewQuery,
  useMergeMemberMutation,
  useRemoveMemberMutation,
  useUpdateMemberStatusMutation,
  useUpdateGroupCurrencyMutation,
  usePutRateMutation,
  useDeleteRateMutation,
  usePutBeancountConfigMutation,
  useSendBeancountExportMutation,
  useCreateGroupMutation,
  useResetInviteMutation,
  useUnlinkChatMutation,
  useAcceptInviteMutation,
  useDeleteGroupMutation,
  useApproveDeleteRequestMutation,
  useCancelDeleteRequestMutation,
} = api;
