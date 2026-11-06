import type { Api } from "grammy";

import { getBot } from "@/bot";
import type { Actor } from "@/lib/record-mutation";

/**
 * Who is writing, and which Telegram API keeps the group message in sync.
 * `api` defaults to the bot's; `null` means the caller renders the message itself.
 */
export type RecordContext = { actor: Actor; api?: Api | null };

/** Extra conditions on an edit. */
export type UpdateOptions = {
  /** Refuse (409) if the record was changed after this instant, e.g. the `updatedAt` an agent read. */
  expectedUpdatedAt?: Date;
};

/** The one place the records layer reaches for the bot. */
export const apiOf = (ctx: RecordContext): Api | null =>
  ctx.api === undefined ? getBot().api : ctx.api;
