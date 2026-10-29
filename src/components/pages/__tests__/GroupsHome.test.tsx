import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";

import { GroupsHome } from "@/components/pages/GroupsHome";
import type { Platform } from "@/components/pages/platform";
import { miniPlatform } from "@/components/pages/platform.mini";
import { webPlatform } from "@/components/pages/platform.web";

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  mockReplace.mockClear();
});

const GROUP = { id: 7, title: "週末旅行", defaultCurrency: "TWD" };

function renderHome(
  platform: Platform,
  me: { groups?: unknown[]; activeGroupId?: number; activeExpenseId?: number } = {},
  fetchError?: string,
) {
  return render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        fallback: fetchError
          ? {}
          : {
              "/api/me/groups": {
                groups: [],
                activeGroupId: null,
                activeExpenseId: null,
                activeSettlementId: null,
                ...me,
              },
              "/api/me/groups/photos": { photos: {} },
            },
        // A failing fetch surfaces as the SWR error the page reacts to.
        fetcher: async () => {
          throw new Error(fetchError ?? "unexpected fetch");
        },
      }}
    >
      <GroupsHome platform={platform} />
    </SWRConfig>,
  );
}

describe("GroupsHome", () => {
  it.each([miniPlatform, webPlatform])(
    "links each group under the platform's own base path (%#)",
    (platform) => {
      renderHome(platform, { groups: [GROUP] });
      expect(screen.getByRole("link", { name: /週末旅行/ })).toHaveAttribute(
        "href",
        `${platform.basePath}/groups/7`,
      );
    },
  );

  it.each([miniPlatform, webPlatform])(
    "tells an empty list to add the bot from Telegram (%#)",
    (platform) => {
      renderHome(platform, { groups: [] });
      expect(screen.getByText("把 Bot 加進 Telegram 群組，輸入 /start 即可")).toBeInTheDocument();
    },
  );

  it.each([miniPlatform, webPlatform])(
    "opens a Telegram deep link's expense under the platform's own base path (%#)",
    (platform) => {
      renderHome(platform, { groups: [GROUP], activeGroupId: 7, activeExpenseId: 11 });
      expect(mockReplace).toHaveBeenCalledWith(`${platform.basePath}/groups/7/expenses/11/edit`);
    },
  );

  it("shows the Mini App its load error when the session check fails with 401", async () => {
    renderHome(miniPlatform, {}, "401 /api/me/groups");
    expect(await screen.findByText("無法載入群組")).toBeInTheDocument();
  });

  it("does not show a 401 on the web, which redirects to login instead", async () => {
    renderHome(webPlatform, {}, "401 /api/me/groups");
    // Let the failed fetch settle before asserting that no error text appeared.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("無法載入群組")).not.toBeInTheDocument();
  });
});
