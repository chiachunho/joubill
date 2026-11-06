import { describe, expect, it, vi } from "vitest";

import { apiErrorStatus, apiErrorText } from "@/lib/api-error";
import { isUnauthorizedError } from "@/lib/auth-redirect";

import { api } from "../api";
import { makeStore } from "../store";
import { Failure, fakeRequest } from "../test-utils";

const reads = (request: ReturnType<typeof fakeRequest>, path: string) =>
  request.mock.calls.filter(([p, init]) => p === path && (init?.method ?? "GET") === "GET").length;

/** Let the invalidation refetch that follows a mutation run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("a failed request", () => {
  it("carries the status, the parsed body and a message the 401 check can read", async () => {
    const request = fakeRequest({ "/api/me/profile": new Failure(401, { error: "no session" }) });
    const store = makeStore(request);

    const result = await store.dispatch(api.endpoints.getProfile.initiate());

    expect(result.error).toMatchObject({ status: 401, data: { error: "no session" } });
    expect(isUnauthorizedError(result.error)).toBe(true);
    expect(apiErrorStatus(result.error)).toBe(401);
    expect(apiErrorText(result.error, "fallback")).toBe("no session");
  });

  it("is status 0 when the request never got a response", async () => {
    const request = vi.fn().mockRejectedValue(new Error("offline"));
    const store = makeStore(request);

    const result = await store.dispatch(api.endpoints.getProfile.initiate());

    expect(apiErrorStatus(result.error)).toBe(0);
    expect(isUnauthorizedError(result.error)).toBe(false);
  });

  it("reports a 401 to the store's handler, and nothing else", async () => {
    const onUnauthorized = vi.fn();
    const request = fakeRequest({
      "/api/me/profile": new Failure(401),
      "/api/me/groups": new Failure(500),
    });
    const store = makeStore(request, { onUnauthorized });

    await store.dispatch(api.endpoints.getMe.initiate());
    expect(onUnauthorized).not.toHaveBeenCalled();

    await store.dispatch(api.endpoints.getProfile.initiate());
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe("record mutations", () => {
  const routes = {
    "/api/groups/7/expenses": { expenses: [], nextCursor: null },
    "/api/groups/7/balance": { currency: "TWD", balances: [] },
    "/api/groups/7/stats?range=6m": { currency: "TWD" },
    "/api/groups/7/expenses/11": { id: 11 },
  };

  async function subscribe(request: ReturnType<typeof fakeRequest>) {
    const store = makeStore(request);
    store.dispatch(api.endpoints.getExpenses.initiate(7));
    store.dispatch(api.endpoints.getBalance.initiate(7));
    store.dispatch(api.endpoints.getStats.initiate({ groupId: 7, range: "6m" }));
    store.dispatch(api.endpoints.getExpense.initiate({ groupId: 7, expenseId: 11 }));
    await settle();
    return store;
  }

  it("refreshes the lists, the balance, the stats and the edited record", async () => {
    const request = fakeRequest({ ...routes, "/api/groups/7/expenses/11": () => ({ id: 11 }) });
    const store = await subscribe(request);

    await store.dispatch(
      api.endpoints.updateExpense.initiate({ groupId: 7, expenseId: 11, body: {} }),
    );
    await settle();

    expect(reads(request, "/api/groups/7/expenses")).toBe(2);
    expect(reads(request, "/api/groups/7/balance")).toBe(2);
    expect(reads(request, "/api/groups/7/stats?range=6m")).toBe(2);
    expect(reads(request, "/api/groups/7/expenses/11")).toBe(2);
  });

  it("does not refetch a deleted record's own detail on the way out", async () => {
    const request = fakeRequest(routes);
    const store = await subscribe(request);

    await store.dispatch(api.endpoints.deleteExpense.initiate({ groupId: 7, expenseId: 11 }));
    await settle();

    expect(reads(request, "/api/groups/7/expenses")).toBe(2);
    expect(reads(request, "/api/groups/7/balance")).toBe(2);
    // The page for it is still mounted while the form navigates away; a refetch would 404.
    expect(reads(request, "/api/groups/7/expenses/11")).toBe(1);
  });

  it("leaves another group's data alone", async () => {
    const request = fakeRequest({ ...routes, "/api/groups/8/balance": { balances: [] } });
    const store = await subscribe(request);
    store.dispatch(api.endpoints.getBalance.initiate(8));
    await settle();

    await store.dispatch(api.endpoints.createExpense.initiate({ groupId: 7, body: {} }));
    await settle();

    expect(reads(request, "/api/groups/7/balance")).toBe(2);
    expect(reads(request, "/api/groups/8/balance")).toBe(1);
  });

  it("treats a group id given as a string and as a number as the same group", async () => {
    const request = fakeRequest(routes);
    const store = await subscribe(request);

    await store.dispatch(api.endpoints.createExpense.initiate({ groupId: "7", body: {} }));
    await settle();

    expect(reads(request, "/api/groups/7/balance")).toBe(2);
  });
});

describe("changing a group's rates", () => {
  it("refreshes every record's detail too, since their converted amounts move", async () => {
    const request = fakeRequest({
      "/api/groups/7/expenses/11": { id: 11 },
      "/api/groups/7/settlements/12": { id: 12 },
      "/api/groups/7/rates": { defaultCurrency: "TWD", rates: [] },
    });
    const store = makeStore(request);
    store.dispatch(api.endpoints.getExpense.initiate({ groupId: 7, expenseId: 11 }));
    store.dispatch(api.endpoints.getSettlement.initiate({ groupId: 7, settlementId: 12 }));
    store.dispatch(api.endpoints.getRates.initiate(7));
    await settle();

    request.mockClear();
    await store.dispatch(
      api.endpoints.putRate.initiate({
        groupId: 7,
        base: "JPY",
        quote: "TWD",
        rate: 0.22,
        lockExisting: false,
      }),
    );
    await settle();

    expect(reads(request, "/api/groups/7/expenses/11")).toBe(1);
    expect(reads(request, "/api/groups/7/settlements/12")).toBe(1);
    expect(reads(request, "/api/groups/7/rates")).toBe(1);
  });
});

describe("optimistic edits", () => {
  const members = {
    members: [
      { id: 1, firstName: "Alice", status: "active" },
      { id: 2, firstName: "Bob", status: "active" },
    ],
  };

  it("shows a member's new status before the server answers, and keeps it once saved", async () => {
    let answer: (r: unknown) => void = () => {};
    const request = fakeRequest({
      "/api/groups/7/members": members,
      "/api/groups/7/members/2": () => new Promise((resolve) => (answer = resolve)),
    });
    const store = makeStore(request);
    store.dispatch(api.endpoints.getMembers.initiate(7));
    await settle();

    const pending = store.dispatch(
      api.endpoints.updateMemberStatus.initiate({ groupId: 7, userId: 2, status: "inactive" }),
    );
    const statusOf = () =>
      api.endpoints.getMembers
        .select(7)(store.getState())
        .data?.members.find((m) => m.id === 2)?.status;
    expect(statusOf()).toBe("inactive");
    answer({});
    await pending;
    expect(statusOf()).toBe("inactive");
  });

  it("puts the status back when the server refuses", async () => {
    const request = fakeRequest({
      "/api/groups/7/members": members,
      "/api/groups/7/members/2": new Failure(403),
    });
    const store = makeStore(request);
    store.dispatch(api.endpoints.getMembers.initiate(7));
    await settle();

    await store.dispatch(
      api.endpoints.updateMemberStatus.initiate({ groupId: 7, userId: 2, status: "inactive" }),
    );

    const data = api.endpoints.getMembers.select(7)(store.getState()).data;
    expect(data?.members.find((m) => m.id === 2)?.status).toBe("active");
  });

  it("puts the default currency back when the server refuses", async () => {
    const request = fakeRequest({
      "/api/groups/7/settings": (init) =>
        init?.method === "PATCH" ? new Failure(500) : { defaultCurrency: "TWD" },
    });
    const store = makeStore(request);
    store.dispatch(api.endpoints.getSettings.initiate(7));
    await settle();

    await store.dispatch(
      api.endpoints.updateGroupCurrency.initiate({ groupId: 7, defaultCurrency: "JPY" }),
    );

    expect(api.endpoints.getSettings.select(7)(store.getState()).data?.defaultCurrency).toBe("TWD");
  });
});

describe("the beancount setting", () => {
  it("takes the saved accounts from the PUT response, without a refetch", async () => {
    const defaults = {
      expensesAccount: "Expenses:Uncategorized",
      cashAccount: "Assets:Cash",
      eventAccount: "Assets:Receivable:Japan",
    };
    const saved = { ...defaults, expensesAccount: "Expenses:Travel" };
    const request = fakeRequest({
      "/api/groups/7/beancount": (init) =>
        init?.method === "PUT" ? { config: saved } : { config: defaults },
    });
    const store = makeStore(request);
    store.dispatch(api.endpoints.getBeancountConfig.initiate(7));
    await settle();
    const current = () => api.endpoints.getBeancountConfig.select(7)(store.getState()).data;
    expect(current()).toEqual({ config: defaults });

    await store.dispatch(api.endpoints.putBeancountConfig.initiate({ groupId: 7, config: saved }));
    await settle();
    expect(current()).toEqual({ config: saved });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("re-reads the export summary after a send moves the watermark", async () => {
    const params = { range: "new" };
    let sent = false;
    const request = fakeRequest({
      "/api/groups/7/beancount/export/summary?range=new": () => ({
        included: sent ? 0 : 3,
        skipped: 0,
        lastExportedAt: sent ? "2026-11-01T00:00:00.000Z" : null,
        telegramLinked: true,
      }),
      "/api/groups/7/beancount/export/send": () => {
        sent = true;
        return { ok: true, included: 3 };
      },
    });
    const store = makeStore(request);
    store.dispatch(api.endpoints.getBeancountExportSummary.initiate({ groupId: 7, params }));
    await settle();
    const current = () =>
      api.endpoints.getBeancountExportSummary.select({ groupId: 7, params })(store.getState()).data;
    expect(current()?.included).toBe(3);

    await store.dispatch(api.endpoints.sendBeancountExport.initiate({ groupId: 7, params }));
    await settle();
    expect(current()?.included).toBe(0);
  });
});

describe("the activity feed", () => {
  it("asks for each next page with the cursor the page before it returned", async () => {
    const request = fakeRequest({
      "/api/groups/7/activity": { entries: [{ id: 3 }], nextCursor: 3 },
      "/api/groups/7/activity?cursor=3": { entries: [{ id: 1 }], nextCursor: null },
    });
    const store = makeStore(request);

    const first = store.dispatch(api.endpoints.getActivity.initiate({ groupId: 7 }));
    await first;
    await store.dispatch(
      api.endpoints.getActivity.initiate({ groupId: 7 }, { direction: "forward" }),
    );
    await settle();

    const state = api.endpoints.getActivity.select({ groupId: 7 })(store.getState());
    expect(state.data?.pages.flatMap((p) => p.entries.map((e) => e.id))).toEqual([3, 1]);
    expect(request.mock.calls.map(([p]) => p)).toEqual([
      "/api/groups/7/activity",
      "/api/groups/7/activity?cursor=3",
    ]);
  });

  it("filters to one record's history", async () => {
    const request = fakeRequest({
      "/api/groups/7/activity?record=11": { entries: [], nextCursor: null },
    });
    const store = makeStore(request);

    await store.dispatch(api.endpoints.getActivity.initiate({ groupId: 7, recordId: "11" }));

    expect(request).toHaveBeenCalledWith("/api/groups/7/activity?record=11", expect.anything());
  });
});

describe("the expense list", () => {
  const page1 = { expenses: [{ id: 3 }], nextCursor: "2026-03-04T05:06:07.123456Z_3", total: 2 };
  const page2 = { expenses: [{ id: 1 }], nextCursor: null };
  const routes = {
    "/api/groups/7/expenses": page1,
    "/api/groups/7/expenses?cursor=2026-03-04T05%3A06%3A07.123456Z_3": page2,
    "/api/groups/7/balance": { currency: "TWD", balances: [] },
    "/api/groups/7/stats?range=6m": { currency: "TWD" },
  };

  it("asks for each next page with the cursor the page before it returned", async () => {
    const request = fakeRequest(routes);
    const store = makeStore(request);

    await store.dispatch(api.endpoints.getExpenses.initiate(7));
    await store.dispatch(api.endpoints.getExpenses.initiate(7, { direction: "forward" }));
    await settle();

    const state = api.endpoints.getExpenses.select(7)(store.getState());
    expect(state.data?.pages.flatMap((p) => p.expenses.map((e) => e.id))).toEqual([3, 1]);
  });

  it("refetches every loaded page after an edit, so a row on page 2 is not left stale", async () => {
    let edited = false;
    const request = fakeRequest({
      ...routes,
      "/api/groups/7/expenses": () => ({ ...page1, expenses: [{ id: edited ? 30 : 3 }] }),
      "/api/groups/7/expenses?cursor=2026-03-04T05%3A06%3A07.123456Z_3": () => ({
        ...page2,
        expenses: [{ id: edited ? 10 : 1 }],
      }),
      "/api/groups/7/expenses/11": { ok: true },
    });
    const store = makeStore(request);
    await store.dispatch(api.endpoints.getExpenses.initiate(7));
    await store.dispatch(api.endpoints.getExpenses.initiate(7, { direction: "forward" }));
    await settle();

    edited = true;
    await store.dispatch(
      api.endpoints.updateExpense.initiate({ groupId: 7, expenseId: 11, body: {} }),
    );
    await settle();

    const state = api.endpoints.getExpenses.select(7)(store.getState());
    expect(state.data?.pages.flatMap((p) => p.expenses.map((e) => e.id))).toEqual([30, 10]);
  });
});

describe("invites and new groups", () => {
  it("refetches the group list after creating a group", async () => {
    const request = fakeRequest({
      "/api/me/groups": { groups: [] },
      "/api/groups": { id: 9 },
    });
    const store = makeStore(request);
    store.dispatch(api.endpoints.getMe.initiate());
    await settle();

    await store.dispatch(
      api.endpoints.createGroup.initiate({
        title: "東京",
        defaultCurrency: "JPY",
        timezone: "Asia/Tokyo",
      }),
    );
    await settle();

    expect(reads(request, "/api/me/groups")).toBe(2);
  });

  it("refetches the members and the group list after joining", async () => {
    const request = fakeRequest({
      "/api/me/groups": { groups: [] },
      "/api/groups/9/members": { members: [] },
      "/api/invites/K7M2QX9PAB/accept": { groupId: 9 },
    });
    const store = makeStore(request);
    store.dispatch(api.endpoints.getMe.initiate());
    store.dispatch(api.endpoints.getMembers.initiate(9));
    await settle();

    await store.dispatch(api.endpoints.acceptInvite.initiate({ code: "K7M2QX9PAB" }));
    await settle();

    expect(reads(request, "/api/me/groups")).toBe(2);
    expect(reads(request, "/api/groups/9/members")).toBe(2);
  });

  it("refetches the invite after a reset", async () => {
    let code = "AAAAABBBBB";
    const request = fakeRequest({
      "/api/groups/9/invite": () => ({ code }),
    });
    const store = makeStore(request);
    store.dispatch(api.endpoints.getInvite.initiate(9));
    await settle();

    code = "CCCCCDDDDD";
    await store.dispatch(api.endpoints.resetInvite.initiate({ groupId: 9 }));
    await settle();

    const result = api.endpoints.getInvite.select(9)(store.getState());
    expect(result.data).toEqual({ code: "CCCCCDDDDD" });
  });

  it("shows the code the reset answered with, even when the refetch after it fails", async () => {
    let reset = false;
    const request = fakeRequest({
      "/api/groups/9/invite": (init) => {
        if (init?.method === "POST") {
          reset = true;
          return { code: "CCCCCDDDDD", miniLink: null };
        }
        return reset ? new Failure(500) : { code: "AAAAABBBBB", miniLink: null };
      },
    });
    const store = makeStore(request);
    store.dispatch(api.endpoints.getInvite.initiate(9));
    await settle();

    await store.dispatch(api.endpoints.resetInvite.initiate({ groupId: 9 }));
    await settle();

    // The revoked AAAAA-BBBBB must not come back, nor stay up because the refetch failed.
    const result = api.endpoints.getInvite.select(9)(store.getState());
    expect(result.data).toEqual({ code: "CCCCCDDDDD", miniLink: null });
  });
});

describe("AI assistant connections", () => {
  const list = { connections: [] };

  it("refetches the list after a create, an edit or a revoke", async () => {
    const request = fakeRequest({
      "/api/me/app-connections": { ...list, connection: {}, token: "sbk_x" },
      "/api/me/app-connections/5": { ok: true },
    });
    const store = makeStore(request);
    store.dispatch(api.endpoints.getAppConnections.initiate());
    await settle();
    expect(reads(request, "/api/me/app-connections")).toBe(1);

    await store.dispatch(
      api.endpoints.createAppConnection.initiate({
        name: "n",
        access: "read",
        allGroups: false,
        groupIds: [1],
      }),
    );
    await settle();
    expect(reads(request, "/api/me/app-connections")).toBe(2);

    await store.dispatch(api.endpoints.updateAppConnection.initiate({ id: 5, access: "write" }));
    await settle();
    expect(reads(request, "/api/me/app-connections")).toBe(3);

    await store.dispatch(api.endpoints.revokeAppConnection.initiate({ id: 5 }));
    await settle();
    expect(reads(request, "/api/me/app-connections")).toBe(4);
  });
});
