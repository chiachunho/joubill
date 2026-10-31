import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { GroupDetailPage } from "@/components/pages/GroupDetailPage";
import type { Platform } from "@/components/pages/platform";
import { Failure, fakeRequest, StoreWrapper } from "@/store/test-utils";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

const ME = {
  userId: 1,
  groups: [{ id: 7, title: "週末旅行", defaultCurrency: "TWD" }],
};

const EXPENSES = {
  expenses: [
    {
      // No payers at all: the row must still render a placeholder avatar.
      id: 11,
      type: "expense",
      amount: 300,
      currency: "TWD",
      description: "午餐",
      spentAt: "2026-07-10T04:00:00Z",
      payers: [],
      splits: [],
    },
  ],
  nextCursor: null,
};

// The viewer (userId 1) owes Bob, so the single transfer has the viewer on the `from` side.
const BALANCE = {
  currency: "TWD",
  balances: [
    { userId: 1, amount: -50, firstName: "Alice", lastName: null, username: null },
    { userId: 2, amount: 50, firstName: "Bob", lastName: null, username: null },
  ],
};

const AVATARS = { groupPhoto: null, userPhotos: {} };

function fakePlatform(basePath: "/mini" | "/app"): Platform {
  return {
    basePath,
    rawRequest: vi.fn() as Platform["rawRequest"],
    useSelfPhoto: () => null,
    HeaderLeading: () => <span>leading</span>,
    useBack: () => {},
    BackLink: () => null,
    // Used only by the group list and personal settings bodies.
    HomeHeader: () => null,
    loginPath: null,
    HelpAction: () => null,
    canDownloadExport: false,
    linkIdentity: null,
    openInBrowser: null,
    inviteHint: `hint for ${basePath}`,
    AccountSection: () => null,
  };
}

/** What the page reads, plus whatever else a test wants to answer (or watch). */
function pageRequest(extra: Parameters<typeof fakeRequest>[0] = {}) {
  return fakeRequest({
    "/api/me/groups": ME,
    "/api/groups/7/expenses": EXPENSES,
    "/api/groups/7/balance": BALANCE,
    "/api/groups/7/avatars": AVATARS,
    ...extra,
  });
}

/** Renders the page and waits for its data: the transfer card is the last thing to appear. */
async function renderPage(platform: Platform, request = pageRequest()) {
  // A thenable already marked fulfilled, so `use(params)` resolves without suspending.
  const params = Object.assign(Promise.resolve({ id: "7" }), {
    status: "fulfilled" as const,
    value: { id: "7" },
  });
  render(
    <TooltipProvider>
      <StoreWrapper request={request}>
        <GroupDetailPage params={params} platform={platform} />
      </StoreWrapper>
    </TooltipProvider>,
  );
  await screen.findByRole("button", { name: "已轉" });
}

describe("GroupDetailPage", () => {
  it.each([
    ["/mini", "/app"],
    ["/app", "/mini"],
  ])("links only under the platform's own base path (%s)", async (basePath, otherBasePath) => {
    await renderPage(fakePlatform(basePath as "/mini" | "/app"));

    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
    const groupHrefs = hrefs.filter((href) => href.includes("/groups/7"));
    expect(groupHrefs.length).toBeGreaterThan(0);
    for (const href of groupHrefs) expect(href.startsWith(`${basePath}/groups/7`)).toBe(true);
    expect(hrefs.some((href) => href.startsWith(otherBasePath))).toBe(false);
  });

  it("renders the platform's header leading control", async () => {
    await renderPage(fakePlatform("/app"));
    expect(screen.getByText("leading")).toBeInTheDocument();
  });

  it("names the viewer 你 in the settle-up confirmation", async () => {
    await renderPage(fakePlatform("/app"));

    fireEvent.click(screen.getByRole("button", { name: "已轉" }));

    expect(document.body.textContent).toContain("你 → Bob");
  });

  it("shows a placeholder avatar for an expense with no payers", async () => {
    await renderPage(fakePlatform("/mini"));
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("settles through the store's request function", async () => {
    const request = pageRequest({ "/api/groups/7/settlements": { id: 99 } });
    await renderPage(fakePlatform("/app"), request);

    fireEvent.click(screen.getByRole("button", { name: "已轉" }));
    fireEvent.click(screen.getByRole("button", { name: "已完成" }));

    await waitFor(() => {
      const post = request.mock.calls.find(([path]) => path === "/api/groups/7/settlements");
      expect(post).toBeDefined();
      const init = post![1]!;
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        fromUserId: 1,
        toUserId: 2,
        amount: 50,
        currency: "TWD",
      });
    });
  });

  it("re-reads the balance and the list after a settlement is saved", async () => {
    const request = pageRequest({ "/api/groups/7/settlements": { id: 99 } });
    await renderPage(fakePlatform("/app"), request);
    const reads = (path: string) => request.mock.calls.filter(([p]) => p === path).length;
    expect(reads("/api/groups/7/balance")).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "已轉" }));
    fireEvent.click(screen.getByRole("button", { name: "已完成" }));

    await waitFor(() => expect(reads("/api/groups/7/balance")).toBeGreaterThan(1));
    expect(reads("/api/groups/7/expenses")).toBeGreaterThan(1);
  });

  it("offers 載入更多 only while the expense list has another page", async () => {
    // jsdom has no IntersectionObserver, so the manual button is the fallback.
    await renderPage(fakePlatform("/app"));
    expect(screen.queryByRole("button", { name: "載入更多" })).toBeNull();
    cleanup();

    const more = { ...EXPENSES, nextCursor: "2026-07-10T04:00:00.000000Z_11" };
    const request = pageRequest({
      "/api/groups/7/expenses": more,
      "/api/groups/7/expenses?cursor=2026-07-10T04%3A00%3A00.000000Z_11": {
        expenses: [{ ...EXPENSES.expenses[0], id: 10, description: "早餐" }],
        nextCursor: null,
      },
    });
    await renderPage(fakePlatform("/app"), request);
    fireEvent.click(await screen.findByRole("button", { name: "載入更多" }));

    expect(await screen.findByText("早餐")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "載入更多" })).toBeNull();
  });

  describe("pending group deletion", () => {
    const REQUEST = (requestedBy: number) => ({
      "/api/groups/7/delete-request": {
        request: {
          id: 1,
          requestedBy,
          requestedByName: "Bob",
          createdAt: "2026-10-28T00:00:00Z",
          expiresAt: "2026-10-30T00:00:00Z",
        },
      },
    });

    it("asks another member to approve or reject", async () => {
      await renderPage(fakePlatform("/app"), pageRequest(REQUEST(2)));
      expect(await screen.findByText("Bob 申請刪除此群組")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "同意刪除" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "拒絕" })).toBeInTheDocument();
    });

    it("leaves the requester's own request to the settings page", async () => {
      await renderPage(fakePlatform("/app"), pageRequest(REQUEST(1)));
      expect(screen.queryByText("Bob 申請刪除此群組")).not.toBeInTheDocument();
    });
  });
  describe("a group with only the viewer", () => {
    const ALONE = {
      members: [
        {
          id: 1,
          firstName: "Alice",
          lastName: null,
          username: null,
          status: "active",
          isPlaceholder: false,
        },
      ],
    };
    const WITH_GHOST = {
      members: [
        ...ALONE.members,
        {
          id: 5,
          firstName: "小明",
          lastName: null,
          username: null,
          status: "active",
          isPlaceholder: true,
        },
      ],
    };
    const INVITE = { code: "K7M2QX9PAB", miniLink: null };

    function soloRequest(extra: Parameters<typeof fakeRequest>[0] = {}) {
      return pageRequest({
        "/api/groups/7/balance": { currency: "TWD", balances: [] },
        "/api/groups/7/members": ALONE,
        "/api/groups/7/invite": INVITE,
        ...extra,
      });
    }

    async function renderSolo(platform: Platform, request = soloRequest()) {
      const params = Object.assign(Promise.resolve({ id: "7" }), {
        status: "fulfilled" as const,
        value: { id: "7" },
      });
      render(
        <TooltipProvider>
          <StoreWrapper request={request}>
            <GroupDetailPage params={params} platform={platform} />
          </StoreWrapper>
        </TooltipProvider>,
      );
      await screen.findByText("Expenses", { exact: false });
    }

    /** The card's one button, then one of the two ways to add someone. */
    async function openAdd(option: "新增沒有帳號的成員" | "用邀請碼邀請") {
      fireEvent.click(await screen.findByRole("button", { name: "新增成員" }));
      fireEvent.click(await screen.findByRole("button", { name: new RegExp(option) }));
    }

    it("shows the card, with one 新增成員 button, instead of 所有帳款已結清", async () => {
      await renderSolo(
        fakePlatform("/app"),
        soloRequest({ "/api/groups/7/expenses": { expenses: [], nextCursor: null, total: 0 } }),
      );

      expect(await screen.findByText("還沒有其他成員")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "新增成員" })).toBeInTheDocument();
      // The invite panel lives in the dialog now, not on the card.
      expect(screen.queryByText("K7M2Q-X9PAB")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "複製邀請碼" })).not.toBeInTheDocument();
      expect(screen.queryByText("所有帳款已結清")).not.toBeInTheDocument();
      expect(screen.getByText("先加入成員，再記第一筆支出")).toBeInTheDocument();
    });

    it("still shows the card when the group already has expenses", async () => {
      await renderSolo(fakePlatform("/app"));
      expect(await screen.findByText("還沒有其他成員")).toBeInTheDocument();
      expect(screen.getByText("午餐")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /支出/ })).toBeInTheDocument();
    });

    it("has no card, and keeps 所有帳款已結清, once a second member exists", async () => {
      await renderSolo(fakePlatform("/app"), soloRequest({ "/api/groups/7/members": WITH_GHOST }));

      expect(await screen.findByText("所有帳款已結清")).toBeInTheDocument();
      expect(screen.queryByText("還沒有其他成員")).not.toBeInTheDocument();
    });

    it("does not look up members when balances already show someone else", async () => {
      const request = pageRequest();
      await renderPage(fakePlatform("/app"), request);
      expect(request.mock.calls.some(([path]) => path === "/api/groups/7/members")).toBe(false);
      expect(screen.queryByText("還沒有其他成員")).not.toBeInTheDocument();
    });

    it("offers 產生邀請碼 for an old group and never issues one on read", async () => {
      const request = soloRequest({ "/api/groups/7/invite": { code: null, miniLink: null } });
      await renderSolo(fakePlatform("/app"), request);
      await openAdd("用邀請碼邀請");

      expect(await screen.findByRole("button", { name: "產生邀請碼" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^(複製|分享)/ })).not.toBeInTheDocument();
      expect(
        request.mock.calls.some(
          ([path, init]) => path === "/api/groups/7/invite" && init?.method === "POST",
        ),
      ).toBe(false);
    });

    it("shows the code, its copy buttons and 重設邀請碼 once 用邀請碼邀請 is picked", async () => {
      await renderSolo(fakePlatform("/app"));
      await openAdd("用邀請碼邀請");
      expect(await screen.findByText("K7M2Q-X9PAB")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "複製邀請碼" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "重設邀請碼" })).toBeInTheDocument();
    });

    it("shows each platform's own invite hint", async () => {
      await renderSolo(fakePlatform("/mini"));
      await openAdd("用邀請碼邀請");
      expect(await screen.findByText("hint for /mini")).toBeInTheDocument();
      cleanup();
      await renderSolo(fakePlatform("/app"));
      await openAdd("用邀請碼邀請");
      expect(await screen.findByText("hint for /app")).toBeInTheDocument();
      expect(screen.queryByText("hint for /mini")).not.toBeInTheDocument();
    });

    it("counts an inactive member as a member: no card, because they can be switched back on", async () => {
      const inactive = {
        members: [
          { ...WITH_GHOST.members[1], status: "inactive", isPlaceholder: false },
          ...ALONE.members,
        ],
      };
      await renderSolo(fakePlatform("/app"), soloRequest({ "/api/groups/7/members": inactive }));

      expect(await screen.findByText("所有帳款已結清")).toBeInTheDocument();
      expect(screen.queryByText("還沒有其他成員")).not.toBeInTheDocument();
    });

    it("makes the card disappear right after a member without an account is added", async () => {
      let members = ALONE;
      const request = soloRequest({
        "/api/groups/7/members": () => members,
        "/api/groups/7/members/placeholder": (init) => {
          expect(JSON.parse(init!.body as string)).toEqual({ firstName: "小明" });
          members = WITH_GHOST;
          return { id: 5 };
        },
      });
      await renderSolo(fakePlatform("/app"), request);

      await openAdd("新增沒有帳號的成員");
      fireEvent.change(screen.getByLabelText("名字"), { target: { value: "小明" } });
      fireEvent.click(screen.getByRole("button", { name: "新增" }));

      await waitFor(() => expect(screen.queryByText("還沒有其他成員")).not.toBeInTheDocument());
      expect(await screen.findByText("所有帳款已結清")).toBeInTheDocument();
    });

    it("shows the server's error when the name is taken", async () => {
      const request = soloRequest({
        "/api/groups/7/members/placeholder": new Failure(409, { error: "名字已被群組成員使用" }),
      });
      await renderSolo(fakePlatform("/app"), request);

      await openAdd("新增沒有帳號的成員");
      fireEvent.change(screen.getByLabelText("名字"), { target: { value: "小明" } });
      fireEvent.click(screen.getByRole("button", { name: "新增" }));

      expect(await screen.findByText("名字已被群組成員使用")).toBeInTheDocument();
      expect(screen.getByText("還沒有其他成員")).toBeInTheDocument();
    });

    it.each(["/mini", "/app"] as const)("links to settings under %s", async (basePath) => {
      await renderSolo(fakePlatform(basePath));
      const link = await screen.findByRole("link", { name: /到群組設定/ });
      expect(link).toHaveAttribute("href", `${basePath}/groups/7/settings`);
    });
  });
});
