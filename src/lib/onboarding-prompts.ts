import { pushSupport, type HomeScreenOffer, type PwaEnv } from "@/lib/pwa";

/**
 * The two cards the group page shows, at most one at a time (issue #67): first 把揪帳加到主畫面？,
 * then 朋友記了你要分的帳時通知你？. Pure, so every rule below is unit-tested; the card component
 * supplies the browser state and keeps the records in this device's storage.
 *
 * Asking happens in the app's own words first. The browser's permission dialog can be shown
 * only once (after 不允許 a page can never ask again), and Chrome quietens sites whose
 * prompts get dismissed, so the system dialog only ever follows a tap on 開啟通知.
 *
 * Records are per device, like what they describe: whether *this* phone has the shortcut, and
 * whether *this* browser is subscribed.
 */

export type PromptKind = "home-screen" | "push";

/** What the person answered last time. Null: never asked on this device. */
export type PromptRecord = { never: true } | { snoozedUntil: number; count: number } | null;

/** 下次再說 waits this long. */
export const SNOOZE_DAYS = 7;
/** After this many 下次再說, the card stops coming back, as if 不要再問. */
export const MAX_SNOOZES = 3;
/** 知道了 on the iPhone steps: not a refusal, but give them time to actually do it. */
export const STEPS_SEEN_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export function snooze(record: PromptRecord, now: number, days = SNOOZE_DAYS): PromptRecord {
  const count = (record && "count" in record ? record.count : 0) + 1;
  if (count >= MAX_SNOOZES) return { never: true };
  return { snoozedUntil: now + days * DAY_MS, count };
}

export const NEVER: PromptRecord = { never: true };

function quiet(record: PromptRecord, now: number): boolean {
  if (!record) return false;
  return "never" in record || record.snoozedUntil > now;
}

function isNever(record: PromptRecord): boolean {
  return !!record && "never" in record;
}

export type PromptInput = {
  env: PwaEnv;
  homeScreen: HomeScreenOffer;
  /** The server has VAPID keys and the build has the public one. */
  pushConfigured: boolean;
  /** `Notification.permission`, or null where there is no Notification API. */
  permission: NotificationPermission | null;
  /** This browser already has a push subscription. */
  subscribed: boolean;
  records: Record<PromptKind, PromptRecord>;
  now: number;
  /** A card for one group of one is pointless: nobody else can record anything. */
  hasOtherMembers: boolean;
  /** The card already shown since the app was opened; a second kind waits for the next visit. */
  shownThisVisit: PromptKind | null;
};

function candidate(input: PromptInput): PromptKind | null {
  const { env, homeScreen, records, now } = input;
  const canAddToHomeScreen = homeScreen === "prompt" || homeScreen === "ios-steps";

  if (canAddToHomeScreen && !quiet(records["home-screen"], now)) return "home-screen";

  const pushReady =
    input.pushConfigured &&
    pushSupport(env) === "supported" &&
    // "granted" without a subscription: allowed once, then lost (a cleared site, a reinstall).
    // Asking again costs no system dialog. "denied" can't be undone from a page.
    (input.permission === "default" || input.permission === "granted") &&
    !input.subscribed &&
    !quiet(records.push, now);
  if (!pushReady) return null;

  // A browser tab that could still become a home-screen app waits for that question to be
  // settled: the card asks for the shortcut first, then notifications in the app itself.
  if (canAddToHomeScreen && !isNever(records["home-screen"])) return null;
  return "push";
}

export function nextPrompt(input: PromptInput): PromptKind | null {
  if (!input.hasOtherMembers) return null;
  const next = candidate(input);
  if (input.shownThisVisit && next !== input.shownThisVisit) return null;
  return next;
}
