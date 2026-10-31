import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PersonalSettings } from "@/components/pages/PersonalSettings";
import type { Platform } from "@/components/pages/platform";
import { miniPlatform } from "@/components/pages/platform.mini";
import { webPlatform } from "@/components/pages/platform.web";
import type { ProfileResponse } from "@/lib/api-types";
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

const PROFILE: ProfileResponse = {
  displayName: null,
  firstName: "小明",
  lastName: null,
  username: "xiaoming",
  photoUrl: null,
  avatarSource: null,
  avatarOptions: [],
};

// The real HelpAction and AccountSection are what these tests check. Only the back
// hook is stubbed: the Telegram back button needs the Telegram SDK, which jsdom lacks.
function withoutBackHook(platform: Platform): Platform {
  return { ...platform, useBack: () => {} };
}

const IDENTITIES = { linked: ["telegram"], enabled: ["telegram", "line", "google"] };

function renderSettings(
  platform: Platform,
  failure?: Failure,
  identities: { linked: string[]; enabled: string[] } = IDENTITIES,
  profile: ProfileResponse = PROFILE,
) {
  const request = fakeRequest({
    "/api/me/profile": failure ?? profile,
    "/api/me/identities": identities,
  });
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

  it("shows the chosen display name instead of the provider's", async () => {
    renderSettings(webPlatform, undefined, IDENTITIES, { ...PROFILE, displayName: "阿明" });
    expect(await screen.findByText("阿明")).toBeInTheDocument();
    expect(screen.queryByText("小明")).not.toBeInTheDocument();
  });

  it("opens the name editor from the pencil, prefilled with the provider name as the hint", async () => {
    renderSettings(miniPlatform);
    fireEvent.click(await screen.findByRole("button", { name: "編輯顯示名稱" }));
    expect(await screen.findByRole("textbox", { name: "顯示名稱" })).toHaveAttribute(
      "placeholder",
      "小明",
    );
  });

  it("makes the avatar a button only when there is more than one picture to choose", async () => {
    const one = { ...PROFILE, avatarOptions: [{ source: "telegram", url: "/t.jpg" }] };
    renderSettings(miniPlatform, undefined, IDENTITIES, one);
    await screen.findByText("小明");
    expect(screen.queryByRole("button", { name: "更換頭像" })).not.toBeInTheDocument();
    cleanup();

    const two = {
      ...PROFILE,
      avatarOptions: [
        { source: "telegram", url: "/t.jpg" },
        { source: "google", url: "/g.jpg" },
      ],
    };
    renderSettings(miniPlatform, undefined, IDENTITIES, two);
    fireEvent.click(await screen.findByRole("button", { name: "更換頭像" }));
    expect(await screen.findByRole("radio", { name: /Google/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /自動/ })).toHaveAttribute("aria-checked", "true");
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

  it("points the Mini App at the merge instructions, which the web reaches through linking", async () => {
    renderSettings(miniPlatform);
    expect(await screen.findByRole("link", { name: /合併另一個帳號/ })).toHaveAttribute(
      "href",
      "/mini/settings/merge",
    );
    cleanup();
    renderSettings(webPlatform);
    await screen.findByText("小明");
    expect(screen.queryByRole("link", { name: /合併另一個帳號/ })).not.toBeInTheDocument();
  });

  it("still shows a non-401 failure on the web", async () => {
    renderSettings(webPlatform, new Failure(500));
    expect(await screen.findByText("無法載入")).toBeInTheDocument();
  });

  describe("login methods", () => {
    const withLink = (linkIdentity: Platform["linkIdentity"]): Platform => ({
      ...webPlatform,
      linkIdentity,
    });

    it("offers to link each enabled provider that is not linked yet, and calls linkIdentity", async () => {
      const linkIdentity = vi.fn();
      renderSettings(withLink(linkIdentity));
      fireEvent.click(await screen.findByRole("button", { name: /連結 Google/ }));
      expect(linkIdentity).toHaveBeenCalledWith("google");
      expect(screen.getByRole("button", { name: /連結 LINE/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /連結 GitHub/ })).not.toBeInTheDocument();
    });

    it("disables linking Google inside an in-app browser, which Google refuses", async () => {
      vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Mobile Safari Line/14.0.0" });
      const linkIdentity = vi.fn();
      renderSettings(withLink(linkIdentity));
      const google = await screen.findByRole("button", { name: /連結 Google/ });
      expect(google).toBeDisabled();
      expect(screen.getByRole("button", { name: /連結 LINE/ })).toBeEnabled();
      expect(screen.getByText(/App 內建瀏覽器/)).toBeInTheDocument();
    });

    it("does not offer to unlink the only login method", async () => {
      renderSettings(withLink(vi.fn()));
      await screen.findByRole("button", { name: /連結 Google/ });
      expect(screen.queryByRole("button", { name: /解除連結/ })).not.toBeInTheDocument();
    });

    it("offers to unlink a non-Telegram method once there is another", async () => {
      renderSettings(withLink(vi.fn()), undefined, {
        linked: ["telegram", "google"],
        enabled: ["telegram", "google"],
      });
      expect(await screen.findByRole("button", { name: /解除連結/ })).toBeInTheDocument();
    });

    it("only lists the methods in the Mini App, which cannot run OAuth", async () => {
      renderSettings(miniPlatform);
      await screen.findByText("登入方式");
      expect(screen.getByText("Telegram")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /連結/ })).not.toBeInTheDocument();
    });
  });
});
