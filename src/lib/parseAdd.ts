import type { MessageEntity } from "grammy/types";
import { z } from "zod";

const shareLineSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("username"), username: z.string().min(1), amount: z.number().positive() }),
  z.object({ type: z.literal("telegramId"), telegramId: z.number().int().positive(), amount: z.number().positive() }),
  z.object({ type: z.literal("self"), amount: z.number().positive() }),
]);

export type ShareLine = z.infer<typeof shareLineSchema>;

/**
 * Parsed `/add` input. Two modes:
 *
 * Single-line (equal split):
 *   /add 300 午餐 [@alice @bob]
 *   shareLines is empty; mentionUsernames / mentionTelegramIds list who splits.
 *
 * Multi-line (unequal split):
 *   /add [total] [description]
 *   @alice 200
 *   我 100
 *   shareLines carries per-person amounts.
 *   - amount non-null → Plan A: specified shares given, remainder split among unspecified members.
 *   - amount null    → Plan B: total inferred from sum of shareLines.
 */
export const parsedAddSchema = z.object({
  amount: z.number().positive().nullable(),
  description: z.string().nullable(),
  shareLines: z.array(shareLineSchema),
  mentionUsernames: z.array(z.string().min(1)),
  mentionTelegramIds: z.array(z.number().int().positive()),
});

export type ParsedAdd = z.infer<typeof parsedAddSchema>;

function parsePositive(s: string): number | null {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseAddMessage(text: string, entities: readonly MessageEntity[] = []): ParsedAdd {
  const lines = text.split("\n");
  const firstLine = lines[0];
  const hasShareLines = lines.length > 1 && lines.slice(1).some((l) => l.trim());

  const cmdMatch = firstLine.match(/^\/add(@\w+)?\s*/i);
  if (!cmdMatch) throw new Error("用法：/add <金額> [說明] [@user1 @user2 ...]");

  const body = firstLine.slice(cmdMatch[0].length);
  const firstToken = body.match(/^\S+/)?.[0];
  const amount = firstToken ? parsePositive(firstToken) : null;

  if (!hasShareLines) {
    // Single-line equal-split mode
    if (!firstToken) throw new Error("用法：/add <金額> [說明] [@user1 @user2 ...]");
    if (amount === null) throw new Error("金額必須是正數，例如 /add 300 午餐 @alice @bob");

    const mentionUsernames: string[] = [];
    const mentionTelegramIds: number[] = [];
    const mentionRanges: Array<[number, number]> = [];
    for (const e of entities) {
      if (e.type === "mention") {
        const slice = firstLine.slice(e.offset, e.offset + e.length);
        if (slice.startsWith("@")) {
          mentionUsernames.push(slice.slice(1).toLowerCase());
          mentionRanges.push([e.offset, e.offset + e.length]);
        }
      } else if (e.type === "text_mention" && e.user && !e.user.is_bot) {
        mentionTelegramIds.push(e.user.id);
        mentionRanges.push([e.offset, e.offset + e.length]);
      }
    }

    const descStart = cmdMatch[0].length + firstToken.length;
    const descChars: string[] = [];
    for (let i = descStart; i < firstLine.length; i++) {
      if (!mentionRanges.some(([s, e]) => i >= s && i < e)) descChars.push(firstLine[i]);
    }
    const description = descChars.join("").replace(/\s+/g, " ").trim();

    return parsedAddSchema.parse({
      amount,
      description: description || null,
      shareLines: [],
      mentionUsernames,
      mentionTelegramIds,
    });
  }

  // Multi-line mode — parse description from first line (no inline mentions expected)
  const descOffset = amount !== null && firstToken ? cmdMatch[0].length + firstToken.length : cmdMatch[0].length;
  const description = firstLine.slice(descOffset).trim() || null;

  // Build absolute character offsets for each line to match text_mention entities
  const lineOffsets: number[] = [];
  let pos = 0;
  for (const line of lines) {
    lineOffsets.push(pos);
    pos += line.length + 1; // +1 for \n
  }

  const shareLines: ShareLine[] = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const lineStart = lineOffsets[i];
    const lineEnd = lineStart + raw.length;

    // text_mention entity: user picked from mention list (no @username in text)
    const tmEntity = entities.find(
      (e) =>
        e.type === "text_mention" &&
        e.user &&
        !e.user.is_bot &&
        e.offset >= lineStart &&
        e.offset < lineEnd,
    );
    if (tmEntity && tmEntity.type === "text_mention" && tmEntity.user) {
      const afterSpan = text.slice(tmEntity.offset + tmEntity.length, lineEnd).trim();
      const n = parsePositive(afterSpan.split(/\s+/)[0] ?? "");
      if (n === null) throw new Error(`第 ${i + 1} 行「${trimmed}」缺少金額`);
      shareLines.push({ type: "telegramId", telegramId: tmEntity.user.id, amount: n });
      continue;
    }

    // @username <amount>
    const mentionMatch = trimmed.match(/^@(\w+)\s+([\d.]+)$/);
    if (mentionMatch) {
      const n = parsePositive(mentionMatch[2]);
      if (n === null) throw new Error(`第 ${i + 1} 行金額無效`);
      shareLines.push({ type: "username", username: mentionMatch[1].toLowerCase(), amount: n });
      continue;
    }

    // 我/me <amount>
    const selfMatch = trimmed.match(/^(我|me)\s+([\d.]+)$/i);
    if (selfMatch) {
      const n = parsePositive(selfMatch[2]);
      if (n === null) throw new Error(`第 ${i + 1} 行金額無效`);
      shareLines.push({ type: "self", amount: n });
      continue;
    }

    throw new Error(`第 ${i + 1} 行格式錯誤，應為「@人 金額」或「我 金額」`);
  }

  if (shareLines.length === 0) throw new Error("多行格式需要至少一行「@人 金額」或「我 金額」");

  return parsedAddSchema.parse({
    amount,
    description,
    shareLines,
    mentionUsernames: [],
    mentionTelegramIds: [],
  });
}
