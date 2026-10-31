import { describe, expect, it } from "vitest";

import { recordPushUrl } from "@/lib/push-notice";
import {
  homeScreenLaunchRedirect,
  homeScreenOffer,
  isIOS,
  pushSupport,
  type PwaEnv,
} from "@/lib/pwa";

const BASE: PwaEnv = {
  standalone: false,
  ios: false,
  inAppBrowser: false,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
};

const IPHONE_SAFARI_TAB: PwaEnv = {
  ...BASE,
  ios: true,
  hasPushManager: false,
  hasNotification: false,
};

describe("pushSupport", () => {
  it("is supported where the APIs exist", () => {
    expect(pushSupport(BASE)).toBe("supported");
    expect(
      pushSupport({
        ...IPHONE_SAFARI_TAB,
        standalone: true,
        hasPushManager: true,
        hasNotification: true,
      }),
    ).toBe("supported");
  });

  it("asks an iPhone in a Safari tab to add the app to the home screen first", () => {
    expect(pushSupport(IPHONE_SAFARI_TAB)).toBe("needs-home-screen");
  });

  it("does not blame the home screen once already opened from it", () => {
    // An iOS older than 16.4 has no push even from the home screen.
    expect(pushSupport({ ...IPHONE_SAFARI_TAB, standalone: true })).toBe("unsupported");
  });

  it("is unsupported in a browser without the APIs", () => {
    expect(pushSupport({ ...BASE, hasPushManager: false })).toBe("unsupported");
  });
});

describe("homeScreenOffer", () => {
  it("hides the row once opened from the home screen", () => {
    expect(homeScreenOffer({ ...BASE, standalone: true }, true)).toBe("installed");
  });

  it("uses the browser's own dialog when it handed one over", () => {
    expect(homeScreenOffer(BASE, true)).toBe("prompt");
  });

  it("shows the steps on iOS, which can't be prompted", () => {
    expect(homeScreenOffer(IPHONE_SAFARI_TAB, false)).toBe("ios-steps");
  });

  it("offers nothing where adding isn't possible", () => {
    expect(homeScreenOffer(BASE, false)).toBe("none");
    expect(homeScreenOffer({ ...IPHONE_SAFARI_TAB, inAppBrowser: true }, false)).toBe("none");
  });
});

describe("isIOS", () => {
  it("recognises an iPhone", () => {
    expect(
      isIOS(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1",
        5,
      ),
    ).toBe(true);
  });

  it("recognises an iPad that asks for the desktop site", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15";
    expect(isIOS(ua, 5)).toBe(true);
    expect(isIOS(ua, 0)).toBe(false);
  });

  it("does not flag Android", () => {
    expect(
      isIOS("Mozilla/5.0 (Linux; Android 15; Pixel 8) Chrome/141.0 Mobile Safari/537.36", 5),
    ).toBe(false);
  });
});

describe("homeScreenLaunchRedirect", () => {
  it("opens 我的群組 when the shortcut was saved on a group page", () => {
    expect(homeScreenLaunchRedirect("/app/groups/12", "")).toBe("/app");
    expect(homeScreenLaunchRedirect("/app/groups/12/settings", "?x=1")).toBe("/app");
  });

  it("stays on 我的群組 itself", () => {
    expect(homeScreenLaunchRedirect("/app", "")).toBeNull();
  });

  it("stays on the record a notification tap opened", () => {
    // Round trip against the producer, not a hand-written query string.
    for (const action of ["created", "updated", "deleted"] as const) {
      for (const type of ["expense", "settlement"] as const) {
        const url = new URL(recordPushUrl(action, type, 12, 99), "https://example.test");
        expect(homeScreenLaunchRedirect(url.pathname, url.search)).toBeNull();
      }
    }
  });

  it("leaves invites, login and the help site where a link sent them", () => {
    expect(homeScreenLaunchRedirect("/join/K7M2QX9PAB", "")).toBeNull();
    expect(homeScreenLaunchRedirect("/login", "?next=/app")).toBeNull();
    expect(homeScreenLaunchRedirect("/help/add-to-home-screen", "")).toBeNull();
  });
});
