import type { MessageEntity } from "grammy/types";
import { z } from "zod";

/**
 * Parsed `/add` input.
 *
 * Grammar (whitespace-separated tokens):
 *   /add <amount> [description-words...] [@mention ...]
 *
 *   - amount: leading positive number, optional decimals
 *   - mentions: collected from `message.entities` so users without a Telegram
 *     username can still be tagged (text_mention entities carry user.id directly)
 *   - description: text after the amount with mention spans stripped
 */
export const parsedAddSchema = z.object({
  amount: z.number().positive(),
  description: z.string().nullable(),
  mentionUsernames: z.array(z.string().min(1)),
  mentionTelegramIds: z.array(z.number().int().positive()),
});

export type ParsedAdd = z.infer<typeof parsedAddSchema>;

export function parseAddMessage(text: string, entities: readonly MessageEntity[] = []): ParsedAdd {
  const cmdMatch = text.match(/^\/add(@\w+)?\s+/i);
  if (!cmdMatch) {
    throw new Error("用法：/add <金額> [說明] [@user1 @user2 ...]");
  }
  const body = text.slice(cmdMatch[0].length);

  const firstToken = body.match(/^\S+/)?.[0];
  if (!firstToken) {
    throw new Error("用法：/add <金額> [說明] [@user1 @user2 ...]");
  }
  const amount = Number(firstToken);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("金額必須是正數，例如 /add 300 午餐 @alice @bob");
  }

  const mentionUsernames: string[] = [];
  const mentionTelegramIds: number[] = [];
  const mentionRanges: Array<[number, number]> = [];
  for (const e of entities) {
    if (e.type === "mention") {
      const slice = text.slice(e.offset, e.offset + e.length);
      if (slice.startsWith("@")) {
        mentionUsernames.push(slice.slice(1).toLowerCase());
        mentionRanges.push([e.offset, e.offset + e.length]);
      }
    } else if (e.type === "text_mention" && e.user) {
      mentionTelegramIds.push(e.user.id);
      mentionRanges.push([e.offset, e.offset + e.length]);
    }
  }

  // Build description: take text after the amount, strip mention spans, collapse whitespace.
  const descStart = cmdMatch[0].length + firstToken.length;
  const descChars: string[] = [];
  for (let i = descStart; i < text.length; i++) {
    const inMention = mentionRanges.some(([s, e]) => i >= s && i < e);
    if (!inMention) descChars.push(text[i]);
  }
  const description = descChars.join("").replace(/\s+/g, " ").trim();

  return parsedAddSchema.parse({
    amount,
    description: description || null,
    mentionUsernames,
    mentionTelegramIds,
  });
}
