import { NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — Telegram's sendPhoto limit

export const POST = withAuth(async (req: Request) => {
  await getAuth(req);

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });
  if (file.size > MAX_BYTES)
    return NextResponse.json({ error: "file too large (max 10 MB)" }, { status: 413 });

  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_STORAGE_CHAT_ID: chatId } = serverEnv();

  const tgForm = new FormData();
  tgForm.append("chat_id", chatId);
  tgForm.append(
    "photo",
    new Blob([await file.arrayBuffer()], { type: file.type }),
    file.name || "receipt.jpg",
  );

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    body: tgForm,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[tg-upload] sendPhoto failed:", text);
    return NextResponse.json({ error: "upload failed" }, { status: 502 });
  }

  const data = (await res.json()) as {
    result: { photo?: Array<{ file_id: string }> };
  };
  const fileId = data.result.photo?.at(-1)?.file_id;
  if (!fileId) {
    // Telegram may return a document instead of a photo for non-standard image formats.
    console.error("[tg-upload] sendPhoto returned no photo array:", JSON.stringify(data.result));
    return NextResponse.json({ error: "upload failed: unsupported image format" }, { status: 502 });
  }
  return NextResponse.json({ fileId });
});
