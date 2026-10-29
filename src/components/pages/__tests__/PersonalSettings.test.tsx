import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";

import { PersonalSettings } from "@/components/pages/PersonalSettings";
import type { Platform } from "@/components/pages/platform";
import { miniPlatform } from "@/components/pages/platform.mini";
import { webPlatform } from "@/components/pages/platform.web";
import { HELP_PATH } from "@/lib/help-url";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// jsdom cannot navigate, so stand in for window.location and watch what is assigned to it.
function stubLocation(path: string) {
  const location = { href: path, pathname: path, search: "" };
  vi.stubGlobal("location", location);
  return location;
}

const PROFILE = { firstName: "小明", lastName: null, username: "xiaoming", photoUrl: null };

// The real HelpAction and AccountSection are what these tests check. Only the back
// hook is stubbed: the Telegram back button needs the Telegram SDK, which jsdom lacks.
function withoutBackHook(platform: Platform): Platform {
  return { ...platform, useBack: () => {} };
}

function renderSettings(platform: Platform, fetchError?: string) {
  return render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        fallback: fetchError ? {} : { "/api/me/profile": PROFILE },
        // A failing fetch surfaces as the SWR error the page reacts to.
        fetcher: async () => {
          throw new Error(fetchError ?? "unexpected fetch");
        },
      }}
    >
      <PersonalSettings platform={withoutBackHook(platform)} />
    </SWRConfig>,
  );
}

describe("PersonalSettings", () => {
  it("shows the profile name on either platform", () => {
    renderSettings(miniPlatform);
    expect(screen.getByText("小明")).toBeInTheDocument();
  });

  it("offers sign-out only on the web", () => {
    renderSettings(webPlatform);
    expect(screen.getByRole("button", { name: "登出" })).toBeInTheDocument();
  });

  it("offers no sign-out in the Mini App, which signs in through Telegram", () => {
    renderSettings(miniPlatform);
    expect(screen.queryByRole("button", { name: "登出" })).not.toBeInTheDocument();
  });

  it("links the help row to the help page on the web", () => {
    renderSettings(webPlatform);
    expect(screen.getByRole("link", { name: /使用說明/ })).toHaveAttribute("href", HELP_PATH);
  });

  it("opens help as a button in the Mini App rather than a link that would replace the app", () => {
    renderSettings(miniPlatform);
    expect(screen.getByRole("button", { name: /使用說明/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /使用說明/ })).not.toBeInTheDocument();
  });

  it("shows the Mini App its load error when the profile request fails with 401", async () => {
    const location = stubLocation("/mini/settings");
    renderSettings(miniPlatform, "401 /api/me/profile");
    expect(await screen.findByText("無法載入")).toBeInTheDocument();
    // Telegram authenticates the Mini App, so there is no login page to leave for.
    expect(location.href).toBe("/mini/settings");
  });

  it("sends the web to login on a 401, carrying this page, without flashing an error", async () => {
    const location = stubLocation("/app/settings");
    renderSettings(webPlatform, "401 /api/me/profile");
    await waitFor(() => expect(location.href).toBe("/login?next=%2Fapp%2Fsettings"));
    expect(screen.queryByText("無法載入")).not.toBeInTheDocument();
  });

  it("still shows a non-401 failure on the web", async () => {
    renderSettings(webPlatform, "500 /api/me/profile");
    expect(await screen.findByText("無法載入")).toBeInTheDocument();
  });
});
