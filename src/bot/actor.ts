import { type Actor } from "@/lib/record-mutation";

import type { BotContext } from "./context";

/**
 * Who is behind the update currently being handled, for the audit log.
 *
 * `ctx.dbUser` is populated by the `registerUser` middleware for any message or
 * callback sender, and every caller here sits behind a guard that has already
 * bailed out with `TOAST.unknownUser` when it is missing — a callback the bot
 * cannot attribute must not be allowed to change a record in the first place.
 */
export function actorOf(ctx: BotContext): Actor {
  return { userId: ctx.dbUser!.id, source: "bot" };
}
