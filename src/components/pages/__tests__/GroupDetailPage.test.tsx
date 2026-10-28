import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";

import { TooltipProvider } from "@/components/ui/tooltip";
import { GroupDetailPage } from "@/components/pages/GroupDetailPage";
import type { Platform } from "@/components/pages/platform";

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

function fakePlatform(basePath: "/mini" | "/app", request = vi.fn()): Platform {
  return {
    basePath,
    request: request as Platform["request"],
    rawRequest: vi.fn() as Platform["rawRequest"],
    useSelfPhoto: () => null,
    HeaderLeading: () => <span>leading</span>,
    useBack: () => {},
    BackLink: () => null,
    // Used only by the group list and personal settings bodies.
    HomeHeader: () => null,
    loginPath: null,
    HelpAction: () => null,
    AccountSection: () => null,
  };
}

function renderPage(platform: Platform) {
  // A thenable already marked fulfilled, so `use(params)` resolves without suspending.
  const params = Object.assign(Promise.resolve({ id: "7" }), {
    status: "fulfilled" as const,
    value: { id: "7" },
  });
  return render(
    <TooltipProvider>
      <SWRConfig
        value={{
          provider: () => new Map(),
          fallback: {
            "/api/me/groups": ME,
            "/api/groups/7/expenses": EXPENSES,
            "/api/groups/7/balance": BALANCE,
            "/api/groups/7/avatars": AVATARS,
          },
        }}
      >
        <GroupDetailPage params={params} platform={platform} />
      </SWRConfig>
    </TooltipProvider>,
  );
}

describe("GroupDetailPage", () => {
  it.each([
    ["/mini", "/app"],
    ["/app", "/mini"],
  ])("links only under the platform's own base path (%s)", (basePath, otherBasePath) => {
    renderPage(fakePlatform(basePath as "/mini" | "/app"));

    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
    const groupHrefs = hrefs.filter((href) => href.includes("/groups/7"));
    expect(groupHrefs.length).toBeGreaterThan(0);
    for (const href of groupHrefs) expect(href.startsWith(`${basePath}/groups/7`)).toBe(true);
    expect(hrefs.some((href) => href.startsWith(otherBasePath))).toBe(false);
  });

  it("renders the platform's header leading control", () => {
    renderPage(fakePlatform("/app"));
    expect(screen.getByText("leading")).toBeInTheDocument();
  });

  it("names the viewer 你 in the settle-up confirmation", () => {
    renderPage(fakePlatform("/app"));

    fireEvent.click(screen.getByRole("button", { name: "已轉" }));

    expect(document.body.textContent).toContain("你 → Bob");
  });

  it("shows a placeholder avatar for an expense with no payers", () => {
    renderPage(fakePlatform("/mini"));
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("settles through the platform's request function", async () => {
    const request = vi.fn().mockResolvedValue({});
    renderPage(fakePlatform("/app", request));

    fireEvent.click(screen.getByRole("button", { name: "已轉" }));
    fireEvent.click(screen.getByRole("button", { name: "已完成" }));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const [path, init] = request.mock.calls[0];
    expect(path).toBe("/api/groups/7/settlements");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      fromUserId: 1,
      toUserId: 2,
      amount: 50,
      currency: "TWD",
    });
  });
});
