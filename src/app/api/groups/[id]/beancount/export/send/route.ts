import { NextResponse } from "next/server";
import { GrammyError, InputFile } from "grammy";

import { getBot } from "@/bot";
import { withAuth } from "@/lib/auth/route";
import { buildBeancountExport, saveBeancountWatermark } from "@/lib/beancount-export";

import { readExportRequest, type Params } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sends the caller's beancount ledger to their own private chat with the bot. This is
 * the Mini App's export (its webview can't take an authenticated download), and it
 * goes to the person, never the group: the file is their personal ledger.
 */
export const POST = withAuth(async (req: Request, ctx: Params) => {
  const json: unknown = await req.json().catch(() => null);
  // `null` or a bare number is valid JSON but not a body to read fields from.
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const request = await readExportRequest(req, ctx, body);
  const { user, groupId, range } = request;

  if (user.telegramId == null) {
    return NextResponse.json({ error: "你的帳號沒有連結 Telegram" }, { status: 400 });
  }

  const file = await buildBeancountExport(user.id, groupId, range);
  if (!file) return NextResponse.json({ error: "group not found" }, { status: 404 });

  try {
    await getBot().api.sendDocument(
      user.telegramId,
      new InputFile(Buffer.from(file.text), file.filename),
      {
        caption: `📒 beancount 帳本，${file.included} 筆${file.corrected > 0 ? `，修正 ${file.corrected} 筆` : ""}`,
      },
    );
  } catch (err) {
    // 403: the person never opened a private chat with the bot, or blocked it.
    if (err instanceof GrammyError && err.error_code === 403) {
      return NextResponse.json(
        { error: "機器人還不能私訊你：請先打開和機器人的私訊並按「開始」，再試一次" },
        { status: 409 },
      );
    }
    console.error("[beancount export] sendDocument failed:", err);
    return NextResponse.json({ error: "傳送失敗，請再試一次" }, { status: 502 });
  }

  if (file.exportedAt) {
    await saveBeancountWatermark(
      user.id,
      groupId,
      file.watermark,
      file.eventAccount,
      file.exportedAt,
    );
  }
  return NextResponse.json({ ok: true, included: file.included, corrected: file.corrected });
});
