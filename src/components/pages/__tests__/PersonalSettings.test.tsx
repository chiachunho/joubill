import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PersonalSettings } from "@/components/pages/PersonalSettings";
import type { Platform } from "@/components/pages/platform";
import { miniPlatform } from "@/components/pages/platform.mini";
import { webPlatform } from "@/components/pages/platform.web";
import { HELP_PATH } from "@/lib/help-url";
import { Failure, fakeRequest, StoreWrapper } from "@/store/test-utils";

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

function renderSettings(platform: Platform, failure?: Failure) {
  const request = fakeRequest({ "/api/me/profile": failure ?? PROFILE });
  return render(
    <StoreWrapper request={request}>
      <PersonalSettings platform={withoutBackHook(platform)} />
    </StoreWrapper>,
  );
}

describe("PersonalSettings", () => {
  it("shows the profile name on either platform", async () => {
    renderSettings(miniPlatform);
    expect(await screen.findByText("小明")).toBeInTheDocument();
  });

  it("offers sign-out only on the web", async () => {
    renderSettings(webPlatform);
    expect(await screen.findByRole("button", { name: "登出" })).toBeInTheDocument();
  });

  it("offers no sign-out in the Mini App, which signs in through Telegram", async () => {
    renderSettings(miniPlatform);
    await screen.findByText("小明");
    expect(screen.queryByRole("button", { name: "登出" })).not.toBeInTheDocument();
  });

  it("links the help row to the help page on the web", async () => {
    renderSettings(webPlatform);
    expect(await screen.findByRole("link", { name: /使用說明/ })).toHaveAttribute(
      "href",
      HELP_PATH,
    );
  });

  it("opens help as a button in the Mini App rather than a link that would replace the app", async () => {
    renderSettings(miniPlatform);
    expect(await screen.findByRole("button", { name: /使用說明/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /使用說明/ })).not.toBeInTheDocument();
  });

  it("shows the Mini App its load error when the profile request fails with 401", async () => {
    const location = stubLocation("/mini/settings");
    renderSettings(miniPlatform, new Failure(401));
    expect(await screen.findByText("無法載入")).toBeInTheDocument();
    // Telegram authenticates the Mini App, so there is no login page to leave for.
    expect(location.href).toBe("/mini/settings");
  });

  it("sends the web to login on a 401, carrying this page, without flashing an error", async () => {
    const location = stubLocation("/app/settings");
    renderSettings(webPlatform, new Failure(401));
    await waitFor(() => expect(location.href).toBe("/login?next=%2Fapp%2Fsettings"));
    expect(screen.queryByText("無法載入")).not.toBeInTheDocument();
  });

  it("still shows a non-401 failure on the web", async () => {
    renderSettings(webPlatform, new Failure(500));
    expect(await screen.findByText("無法載入")).toBeInTheDocument();
  });
});
