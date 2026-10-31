import { describe, expect, it } from "vitest";

import {
  MAX_SNOOZES,
  NEVER,
  nextPrompt,
  snooze,
  SNOOZE_DAYS,
  type PromptInput,
} from "@/lib/onboarding-prompts";
import type { PwaEnv } from "@/lib/pwa";

const NOW = Date.UTC(2026, 9, 31);
const DAY = 24 * 60 * 60 * 1000;

const ANDROID_TAB: PwaEnv = {
  standalone: false,
  ios: false,
  inAppBrowser: false,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
};
const IPHONE_TAB: PwaEnv = {
  ...ANDROID_TAB,
  ios: true,
  hasPushManager: false,
  hasNotification: false,
};
const IPHONE_APP: PwaEnv = { ...ANDROID_TAB, ios: true, standalone: true };

function input(over: Partial<PromptInput> = {}): PromptInput {
  return {
    env: ANDROID_TAB,
    homeScreen: "prompt",
    pushConfigured: true,
    permission: "default",
    subscribed: false,
    records: { "home-screen": null, push: null },
    now: NOW,
    hasOtherMembers: true,
    shownThisVisit: null,
    ...over,
  };
}

describe("nextPrompt", () => {
  it("asks for the home-screen shortcut first", () => {
    expect(nextPrompt(input())).toBe("home-screen");
    expect(nextPrompt(input({ env: IPHONE_TAB, homeScreen: "ios-steps" }))).toBe("home-screen");
  });

  it("asks about notifications once opened from the home screen", () => {
    expect(nextPrompt(input({ env: IPHONE_APP, homeScreen: "installed" }))).toBe("push");
  });

  it("asks about notifications in an Android tab only after the shortcut was declined for good", () => {
    const snoozed = { snoozedUntil: NOW + DAY, count: 1 };
    expect(nextPrompt(input({ records: { "home-screen": snoozed, push: null } }))).toBeNull();
    expect(nextPrompt(input({ records: { "home-screen": NEVER, push: null } }))).toBe("push");
  });

  it("asks about notifications where no shortcut can be offered", () => {
    expect(nextPrompt(input({ homeScreen: "none" }))).toBe("push");
  });

  it("never asks an iPhone tab about notifications, which it can't receive", () => {
    expect(
      nextPrompt(
        input({
          env: IPHONE_TAB,
          homeScreen: "ios-steps",
          records: { "home-screen": NEVER, push: null },
        }),
      ),
    ).toBeNull();
  });

  it("stays quiet while snoozed and asks again after", () => {
    const records = { "home-screen": { snoozedUntil: NOW + DAY, count: 1 }, push: null };
    expect(nextPrompt(input({ records }))).toBeNull();
    expect(nextPrompt(input({ records, now: NOW + 2 * DAY }))).toBe("home-screen");
  });

  it("does not ask about notifications once decided, refused or unavailable", () => {
    const app = { env: IPHONE_APP, homeScreen: "installed" as const };
    expect(nextPrompt(input({ ...app, subscribed: true }))).toBeNull();
    expect(nextPrompt(input({ ...app, permission: "denied" }))).toBeNull();
    expect(nextPrompt(input({ ...app, permission: "granted" }))).toBe("push");
    expect(nextPrompt(input({ ...app, pushConfigured: false }))).toBeNull();
    expect(nextPrompt(input({ ...app, records: { "home-screen": null, push: NEVER } }))).toBeNull();
  });

  it("shows nothing in a group of one", () => {
    expect(nextPrompt(input({ hasOtherMembers: false }))).toBeNull();
  });

  it("shows at most one kind of card per visit", () => {
    // The shortcut card was dismissed for good this visit; notifications wait for the next one.
    const records = { "home-screen": NEVER, push: null };
    expect(nextPrompt(input({ records, shownThisVisit: "home-screen" }))).toBeNull();
    expect(nextPrompt(input({ records, shownThisVisit: null }))).toBe("push");
  });
});

describe("snooze", () => {
  it("waits a week, then gives up after the last allowed snooze", () => {
    const first = snooze(null, NOW);
    expect(first).toEqual({ snoozedUntil: NOW + SNOOZE_DAYS * DAY, count: 1 });
    let record = first;
    for (let i = 1; i < MAX_SNOOZES; i++) record = snooze(record, NOW);
    expect(record).toEqual(NEVER);
  });
});
