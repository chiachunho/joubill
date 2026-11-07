/**
 * The wording of 記帳通知發送位置, shared by the bot's `/topic` panel, the App's Telegram page
 * and the fallback notice. Pure, so the client can import it (`notice-thread.ts` needs the db).
 */

/** A topic as stored: Telegram's `message_thread_id` and its name, if known. */
export type NoticeThread = { id: number; name: string | null };

/** What a stored topic is called on screen; a topic whose name we never saw still needs a label. */
export function topicName(name: string | null): string {
  return name?.trim() || "未命名的主題";
}

/** The explanation under the setting, in the App and on the bot's `/topic` panel. */
export const NOTICE_THREAD_PURPOSE =
  "從 App 新增的記帳卡片、還款通知和匯出檔會發到這裡；在群組裡打的指令，回覆會留在打指令的地方。";

/** Posted in General when the chosen topic has gone and the setting fell back to it. */
export function threadGoneNotice(name: string | null): string {
  const named = name?.trim() ? `「${name.trim()}」` : "";
  return (
    `⚠️ 找不到主題${named}（可能已刪除或關閉），之後的記帳通知改發在 General。\n` +
    "要換成別的主題，請到那個主題裡輸入 /topic。"
  );
}
