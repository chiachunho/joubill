import { Bot, type Composer } from "grammy";
import type { Message, MessageEntity, Update, UserFromGetMe } from "grammy/types";
import { vi } from "vitest";

import type { Group, User } from "@/db/schema";

import type { BotContext } from "../context";

/**
 * Runs one bot Composer against hand-built updates with no network: every Bot API call
 * goes through a transformer that records it and answers from `answers`. Only `send*`
 * methods have a default answer (the sent message); any other method the test didn't
 * stub fails and is listed by `expectAllCallsStubbed`, so a forgotten stub can't quietly
 * steer a command down another path. `registerUser` is skipped; the test sets
 * `ctx.dbUser` / `ctx.dbGroup` itself, which is what that middleware would have attached.
 */

export const BOT_INFO: UserFromGetMe = {
  id: 999,
  is_bot: true,
  first_name: "揪帳",
  username: "splitbill_test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

export const CHAT_ID = -1001234567;

/** An API call the bot made. */
type ApiCall = { method: string; payload: Record<string, unknown>; result: unknown };

/** Answer an API call with a Bot API error (grammY throws a GrammyError for it). */
export class ApiFailure {
  constructor(
    readonly code = 400,
    readonly description = "Bad Request: user not found",
  ) {}
}

type Answer = (payload: Record<string, unknown>) => unknown;

export type TgUser = { id: number; first_name: string; username?: string };

const SENDER: TgUser = { id: 1001, first_name: "Alice", username: "alice" };

let messageIds = 500;

/** Methods a test called without stubbing, across every bot made since the last check. */
const unstubbed: string[] = [];

function defaultAnswer(method: string, payload: Record<string, unknown>): unknown {
  if (method.startsWith("send")) {
    return {
      message_id: ++messageIds,
      date: 0,
      chat: { id: payload.chat_id, type: "supergroup", title: "Test" },
      text: payload.text,
    };
  }
  unstubbed.push(method);
  return new ApiFailure(500, `${method} is not stubbed in this test`);
}

/** Call from `afterEach`: fails if a command made a Bot API call the test didn't stub. */
export function expectAllCallsStubbed() {
  const methods = unstubbed.splice(0);
  if (methods.length > 0) {
    throw new Error(`unstubbed Bot API calls: ${methods.join(", ")} (stub them with answer())`);
  }
}

export function dbUser(over: Partial<User> = {}): User {
  return {
    id: 1,
    telegramId: SENDER.id,
    firstName: SENDER.first_name,
    lastName: null,
    username: SENDER.username ?? null,
    displayName: null,
    ...over,
  } as User;
}

export function dbGroup(over: Partial<Group> = {}): Group {
  return {
    id: 7,
    chatType: "telegram",
    chatId: String(CHAT_ID),
    title: "Test",
    defaultCurrency: "TWD",
    timezone: "Asia/Taipei",
    noticeThreadId: null,
    noticeThreadName: null,
    ...over,
  } as Group;
}

export function testBot(
  composer: Composer<BotContext>,
  ctxRows: { user?: User; group?: Group } = { user: dbUser(), group: dbGroup() },
) {
  const bot = new Bot<BotContext>("123456:test-bot-token", { botInfo: BOT_INFO });
  const calls: ApiCall[] = [];
  const answers: Record<string, Answer> = {};

  bot.api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    const value = answers[method] ? answers[method](p) : defaultAnswer(method, p);
    calls.push({ method, payload: p, result: value });
    if (value instanceof ApiFailure) {
      return { ok: false, error_code: value.code, description: value.description } as never;
    }
    return { ok: true, result: value } as never;
  });
  bot.use((ctx, next) => {
    ctx.dbUser = ctxRows.user;
    ctx.dbGroup = ctxRows.group;
    return next();
  });
  bot.use(composer);
  bot.catch((err) => {
    throw err.error;
  });

  return {
    /** Replace the answer for one Bot API method. */
    answer(method: string, fn: Answer) {
      answers[method] = fn;
    },
    /** What the API answered to each call of one method, in order. */
    resultsOf(method: string) {
      return calls.filter((c) => c.method === method).map((c) => c.result);
    },
    /** Calls of one method, in order. */
    callsOf(method: string) {
      return calls.filter((c) => c.method === method).map((c) => c.payload);
    },
    /** The text of every message the bot sent. */
    replies() {
      return calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
    },
    send: (text: string, opts: SendOptions = {}) => bot.handleUpdate(messageUpdate(text, opts)),
    /** Tap an inline button: a callback query carrying `data` on one of the bot's messages. */
    press: (data: string, opts: PressOptions = {}) => bot.handleUpdate(callbackUpdate(data, opts)),
  };
}

type SendOptions = {
  from?: TgUser;
  /** A private chat with the sender instead of the group. */
  privateChat?: boolean;
  replyTo?: Partial<Message>;
  entities?: MessageEntity[];
  /** Fields laid over the message last, such as a topic (`message_thread_id`) or a forum chat. */
  extra?: Partial<Message>;
};

type PressOptions = {
  from?: TgUser;
  messageDate?: number;
  /** Fields laid over the message the button is on. */
  extra?: Partial<Message>;
};

let updateIds = 1;

/** A text message; a leading `/command` gets its `bot_command` entity like Telegram adds. */
function messageUpdate(text: string, opts: SendOptions = {}): Update {
  const from = { is_bot: false, ...(opts.from ?? SENDER) };
  const chat = opts.privateChat
    ? { id: from.id, type: "private" as const, first_name: from.first_name }
    : { id: CHAT_ID, type: "supergroup" as const, title: "Test" };
  const command = /^\/\w+(@\w+)?/.exec(text);
  const entities: MessageEntity[] = [
    ...(command ? [{ type: "bot_command" as const, offset: 0, length: command[0].length }] : []),
    ...(opts.entities ?? []),
  ];
  return {
    update_id: updateIds++,
    message: {
      message_id: ++messageIds,
      date: Math.floor(Date.now() / 1000),
      chat,
      from,
      text,
      entities,
      ...(opts.replyTo ? { reply_to_message: opts.replyTo as Message } : {}),
      ...opts.extra,
    } as Message,
  } as Update;
}

/** A tap on an inline button of a message in the group. */
function callbackUpdate(data: string, opts: PressOptions = {}): Update {
  const from = { is_bot: false, ...(opts.from ?? SENDER) };
  return {
    update_id: updateIds++,
    callback_query: {
      id: String(++messageIds),
      from,
      chat_instance: "test",
      data,
      message: {
        message_id: ++messageIds,
        date: opts.messageDate ?? Math.floor(Date.now() / 1000),
        chat: { id: CHAT_ID, type: "supergroup", title: "Test" },
        text: "prompt",
        ...opts.extra,
      },
    },
  } as Update;
}

/** A message posted by `from` in the group, to reply to. */
export function groupMessage(from: TgUser, text = "hi"): Partial<Message> {
  return {
    message_id: ++messageIds,
    date: 0,
    chat: { id: CHAT_ID, type: "supergroup", title: "Test" },
    from: { is_bot: false, ...from },
    text,
  } as Partial<Message>;
}

/**
 * A stand-in for `@/db` that records inserts. `insert(t).values(v)` is awaitable, and
 * `.onConflictDoNothing().returning()` answers with `returning` (an empty array means the
 * conflict fired, i.e. the row already existed). Anything else throws, so a test can't
 * pass on a query it didn't plan for.
 */
function fakeDb() {
  const inserts: { table: unknown; values: unknown }[] = [];
  const state = { returning: [{}] as unknown[] };
  const db = {
    insert: vi.fn((table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        const done = Promise.resolve([]);
        return Object.assign(done, {
          onConflictDoNothing: () => ({ returning: async () => state.returning }),
          returning: async () => state.returning,
        });
      },
    })),
  };
  return { db, inserts, state };
}

/**
 * One fake database shared by a test file, for `vi.mock("@/db", …)`, which is hoisted
 * above imports and so can't build its own:
 *
 *   vi.mock("@/db", async () => ({ db: (await import("./harness")).testDb.db }));
 */
export const testDb = fakeDb();

export function resetTestDb() {
  testDb.inserts.length = 0;
  testDb.state.returning = [{}];
  testDb.db.insert.mockClear();
}
