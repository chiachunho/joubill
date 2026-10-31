import { describe, expect, it } from "vitest";

import { recordPushUrl } from "@/lib/push-notice";
import { homeScreenOffer, isIOS, LAUNCH_SCRIPT, pushSupport, type PwaEnv } from "@/lib/pwa";

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

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 15; Pixel 8) Chrome/141.0 Mobile Safari/537.36";

/** Runs the exact inline script against stubbed browser objects; returns what it did. */
function launch(
  path: string,
  { standalone = true, ua = IPHONE_UA, launched = false } = {},
): { replacedWith: string | null; address: string; launchedAfter: boolean } {
  const store = new Map<string, string>(launched ? [["jiuzhang:launched", "1"]] : []);
  let address = path;
  let replacedWith: string | null = null;
  const location = {
    href: `https://example.test${path}`,
    replace: (to: string) => {
      replacedWith = to;
    },
  };
  const history = {
    state: null,
    replaceState: (_s: unknown, _t: string, to: string) => {
      address = to;
    },
  };
  const sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const window = { matchMedia: () => ({ matches: standalone }) };
  const navigator = { userAgent: ua, maxTouchPoints: 5 };
  new Function("window", "location", "history", "navigator", "sessionStorage", LAUNCH_SCRIPT)(
    window,
    location,
    history,
    navigator,
    sessionStorage,
  );
  return { replacedWith, address, launchedAfter: store.has("jiuzhang:launched") };
}

describe("LAUNCH_SCRIPT", () => {
  it("opens 我的群組 when the iPhone shortcut was saved on a group page", () => {
    expect(launch("/app/groups/12").replacedWith).toBe("/app");
    expect(launch("/app/groups/12/settings?x=1").replacedWith).toBe("/app");
  });

  it("only on the first page of a launch", () => {
    expect(launch("/app/groups/12", { launched: true }).replacedWith).toBeNull();
    expect(launch("/app").launchedAfter).toBe(true);
  });

  it("stays on 我的群組 itself", () => {
    expect(launch("/app").replacedWith).toBeNull();
  });

  it("leaves a browser tab and Android alone", () => {
    expect(launch("/app/groups/12", { standalone: false }).replacedWith).toBeNull();
    expect(launch("/app/groups/12", { ua: ANDROID_UA }).replacedWith).toBeNull();
  });

  it("leaves invites, login and the help site where a link sent them", () => {
    expect(launch("/join/K7M2QX9PAB").replacedWith).toBeNull();
    expect(launch("/login?next=/app").replacedWith).toBeNull();
    expect(launch("/help/add-to-home-screen").replacedWith).toBeNull();
  });

  it("stays on the record a notification tap opened, and drops the marker", () => {
    // Round trip against the producer, not a hand-written query string.
    for (const action of ["created", "updated", "deleted"] as const) {
      for (const type of ["expense", "settlement"] as const) {
        const url = recordPushUrl(action, type, 12, 99);
        const result = launch(url);
        expect(result.replacedWith).toBeNull();
        expect(result.address).not.toContain("via=");
        expect(result.address).toBe(url.replace(/[?&]via=push$/, ""));
      }
    }
  });

  it("drops the marker in a browser tab too", () => {
    const url = recordPushUrl("created", "expense", 12, 99);
    expect(launch(url, { standalone: false, ua: ANDROID_UA }).address).toBe(
      "/app/groups/12/expenses/99/edit",
    );
  });
});
