import { z } from "zod";

/**
 * Parsed `/add` input.
 *
 * Grammar (whitespace-separated tokens):
 *   /add <amount> [description-words...] [@username ...]
 *
 *   - amount: leading positive number, optional decimals
 *   - mentions: tokens starting with @, collected regardless of position
 *   - description: remaining middle tokens, joined with spaces
 */
export const parsedAddSchema = z.object({
  amount: z.number().positive(),
  description: z.string().nullable(),
  mentionUsernames: z.array(z.string().min(1)),
});

export type ParsedAdd = z.infer<typeof parsedAddSchema>;

export function parseAddInput(text: string): ParsedAdd {
  const body = text.replace(/^\/add(@\w+)?\s*/i, "").trim();
  if (!body) throw new Error("用法：/add <金額> [說明] [@user1 @user2 ...]");

  const tokens = body.split(/\s+/);
  const amount = Number(tokens[0]);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("金額必須是正數，例如 /add 300 午餐 @alice @bob");
  }

  const mentionUsernames: string[] = [];
  const descTokens: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("@") && t.length > 1) {
      mentionUsernames.push(t.slice(1).toLowerCase());
    } else {
      descTokens.push(t);
    }
  }

  return parsedAddSchema.parse({
    amount,
    description: descTokens.length ? descTokens.join(" ") : null,
    mentionUsernames,
  });
}
