import { NextResponse } from "next/server";
import { InputFile } from "grammy";
import { eq } from "drizzle-orm";

import { getBot } from "@/bot";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { telegramChatId } from "@/lib/chat";
import { buildGroupExport } from "@/lib/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Posts the CSV into the group's Telegram chat. This is the Mini App's export:
 * Telegram's webview can't be handed an authenticated download, but the bot can
 * drop the file in the chat where every member can open it.
 */
export const POST = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
  if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 });
  const chatId = telegramChatId(group);
  if (chatId === null) {
    return NextResponse.json({ error: "這個群組沒有 Telegram 聊天室" }, { status: 400 });
  }

  const file = await buildGroupExport(groupId);
  if (!file) return NextResponse.json({ error: "group not found" }, { status: 404 });

  try {
    await getBot().api.sendDocument(chatId, new InputFile(Buffer.from(file.csv), file.filename));
  } catch (err) {
    console.error("[export] sendDocument failed:", err);
    return NextResponse.json({ error: "傳送失敗，請確認機器人還在群組裡" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
});
