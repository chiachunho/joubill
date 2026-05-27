import type { Context as GrammyContext } from "grammy";

import type { Group, User } from "@/db/schema";

/** 擴充 grammY context，讓 middleware 把已註冊的 user / group 塞給下游 handler。 */
export interface BotContext extends GrammyContext {
  /** 由 registerUser middleware 設定。private chat 也會有。 */
  dbUser?: User;
  /** 由 registerUser middleware 設定。僅 group / supergroup 有。 */
  dbGroup?: Group;
}
