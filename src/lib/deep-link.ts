import { serverEnv } from "@/lib/env";
import { normalizeInviteCode } from "@/lib/invite";

/**
 * Mini App deep links — the `startapp` payload, built here and parsed here.
 *
 * The format is a wire contract with two ends that are far apart: the bot builds
 * these URLs (expense card, settlement notice, /start, /app, /list, /balance,
 * /join) and the API auth path reads the payload back out of Telegram's
 * `initData.start_param` to decide which group — and which record — to open. A
 * builder that drifts from the parser doesn't fail loudly; the link just lands
 * on the group list, or nowhere, and nobody notices for a while.
 *
 * So the shape lives in exactly one file, with `parseStartParam` unit-tested
 * against the builders rather than against hand-written strings.
 *
 * Telegram restriction worth remembering at the call sites: a `web_app` button
 * only works in private chat, so groups get a plain url button with `startapp`,
 * which Telegram turns into a Mini App launch.
 */

/** `group_<chatId>` — opens the group. */
export function groupLink(botUsername: string, chatId: number): string {
  return miniAppUrl(botUsername, `group_${chatId}`);
}

/** `group_<chatId>_exp_<id>` — opens an expense's edit form. */
export function expenseLink(botUsername: string, chatId: number, expenseId: number): string {
  return miniAppUrl(botUsername, `group_${chatId}_exp_${expenseId}`);
}

/** `group_<chatId>_stl_<id>` — opens a settlement's edit form. */
export function settlementLink(botUsername: string, chatId: number, settlementId: number): string {
  return miniAppUrl(botUsername, `group_${chatId}_stl_${settlementId}`);
}

/** `join_<code>` — opens the invite preview, where the person confirms joining. */
export function joinLink(botUsername: string, code: string): string {
  return miniAppUrl(botUsername, `join_${code}`);
}

function miniAppUrl(botUsername: string, startParam: string): string {
  const appName = serverEnv().TELEGRAM_MINI_APP_NAME;
  return `https://t.me/${botUsername}/${appName}?startapp=${startParam}`;
}

export type StartParam =
  | {
      kind: "group";
      /** Telegram chat id — negative for groups, so the pattern allows a leading `-`. */
      telegramChatId: number;
      /** Set when the link pointed at one record. */
      record?: { kind: "expense" | "settlement"; id: number };
    }
  | { kind: "join"; code: string };

const WITH_RECORD = /^group_(-?\d+)_(exp|stl)_(\d+)$/;
const GROUP_ONLY = /^group_(-?\d+)$/;
const JOIN = /^join_([A-Za-z0-9]+)$/;

/** Reads a `startapp` payload back. Returns null for anything unrecognised. */
export function parseStartParam(raw: string | null | undefined): StartParam | null {
  if (!raw) return null;

  const join = raw.match(JOIN);
  if (join) {
    const code = normalizeInviteCode(join[1]);
    return code ? { kind: "join", code } : null;
  }

  const withRecord = raw.match(WITH_RECORD);
  if (withRecord) {
    const telegramChatId = Number(withRecord[1]);
    if (!Number.isFinite(telegramChatId)) return null;
    return {
      kind: "group",
      telegramChatId,
      record: {
        kind: withRecord[2] === "exp" ? "expense" : "settlement",
        id: Number(withRecord[3]),
      },
    };
  }

  const groupOnly = raw.match(GROUP_ONLY);
  if (groupOnly) {
    const telegramChatId = Number(groupOnly[1]);
    if (!Number.isFinite(telegramChatId)) return null;
    return { kind: "group", telegramChatId };
  }

  return null;
}
