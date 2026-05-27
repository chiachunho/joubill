import type { Context as GrammyContext } from "grammy";

import type { Group, User } from "@/db/schema";

/** Extended grammY context. registerUser middleware attaches the persisted rows here. */
export interface BotContext extends GrammyContext {
  /** Set by registerUser middleware. Present for any chat type. */
  dbUser?: User;
  /** Set by registerUser middleware. Only present in group / supergroup chats. */
  dbGroup?: Group;
}
