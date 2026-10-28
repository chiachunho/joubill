import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SWRConfig } from "swr";

import { PersonalSettings } from "@/components/pages/PersonalSettings";
import { miniPlatform, webPlatform, type Platform } from "@/components/pages/platform";
import { HELP_PATH } from "@/lib/help-url";

afterEach(() => {
  cleanup();
});

const PROFILE = { firstName: "小明", lastName: null, username: "xiaoming", photoUrl: null };

// The real HelpAction and AccountSection are what these tests check. Only the back
// hook is stubbed: the Telegram back button needs the Telegram SDK, which jsdom lacks.
function withoutBackHook(platform: Platform): Platform {
  return { ...platform, useBack: () => {} };
}

function renderSettings(platform: Platform) {
  return render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        fallback: { "/api/me/profile": PROFILE },
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
});
