import { createApi } from "@reduxjs/toolkit/query/react";

import type {
  ActivityResponse,
  AvatarsResponse,
  BalanceResponse,
  BeancountConfigResponse,
  DeleteGroupResponse,
  DeleteRequestResponse,
  EffectiveRateResponse,
  ExpenseDetail,
  ExpensesResponse,
  GroupPhotosResponse,
  MeResponse,
  MembersResponse,
  ProfileResponse,
  RatesResponse,
  SettingsResponse,
  SettlementDetail,
  StatsResponse,
} from "@/lib/api-types";
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
  "DeleteRequest",
] as const;

type Tag = { type: (typeof tagTypes)[number]; id: string };

const tag = (type: Tag["type"], id: string): Tag => ({ type, id });

/** What any create / edit / delete of an expense or settlement changes. */
function ledgerTags(groupId: GroupId): Tag[] {
  return [
    tag("Expenses", g(groupId)),
    tag("Balance", g(groupId)),
    tag("Stats", g(groupId)),
    tag("Activity", g(groupId)),
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
    getProfile: build.query<ProfileResponse, void>({
      query: () => ({ url: "/api/me/profile" }),
      providesTags: [tag("Profile", "ME")],
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
      { groupId: GroupId; recordId?: string | null },
      /** The `nextCursor` of the page before; 0 for the first page. */
      number
    >({
      infiniteQueryOptions: {
        initialPageParam: 0,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
      query: ({ queryArg: { groupId, recordId }, pageParam }) => {
        const params: string[] = [];
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
 * The two edits that update the screen before the server answers. They sit in a
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
     * Turn the beancount copy button on, or change its accounts. The response is the saved
     * config, written straight into the cache so the settings page switches to its enabled
     * layout in the same render the save finishes in, instead of a refetch later.
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
    /** Turn it off: the config is deleted, so the cache says so without waiting for a refetch. */
    deleteBeancountConfig: build.mutation<unknown, { groupId: GroupId }>({
      query: ({ groupId }) => ({ url: `/api/groups/${groupId}/beancount`, method: "DELETE" }),
      async onQueryStarted({ groupId }, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
          dispatch(baseApi.util.upsertQueryData("getBeancountConfig", groupId, { config: null }));
        } catch {
          // the page shows the error from the mutation itself
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
  }),
});

export const {
  useGetMeQuery,
  useGetGroupPhotosQuery,
  useGetProfileQuery,
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
  useRemoveMemberMutation,
  useUpdateMemberStatusMutation,
  useUpdateGroupCurrencyMutation,
  usePutRateMutation,
  useDeleteRateMutation,
  usePutBeancountConfigMutation,
  useDeleteBeancountConfigMutation,
  useDeleteGroupMutation,
  useApproveDeleteRequestMutation,
  useCancelDeleteRequestMutation,
} = api;
