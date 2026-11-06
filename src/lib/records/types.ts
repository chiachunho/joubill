import type { Api } from "grammy";

import type { Actor } from "@/lib/record-mutation";

/**
 * Who is writing, and which Telegram API keeps the group message in sync.
 * `api` defaults to the bot's; `null` means the caller renders the message itself.
 */
export type RecordContext = { actor: Actor; api?: Api | null };
