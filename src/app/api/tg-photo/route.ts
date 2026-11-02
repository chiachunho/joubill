import { serverEnv } from "@/lib/env";
import { verifyPhotoSig } from "@/lib/tg-photo-sign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxy Telegram file downloads so the bot token never appears in client-visible URLs.
//
// Every request must carry `sig`, minted by an authenticated route (see tg-photo-sign.ts):
// <img> can't send the Mini App's auth header, so the signature is what stops a bare
// `fileId` or a guessed `photos/file_N.jpg` path from reading someone's receipts.
const SAFE_PATH = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?:\.[A-Za-z0-9]+)?$/;
const SAFE_FILE_ID = /^[A-Za-z0-9_-]+$/;
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif)$/;

async function resolveFilePath(token: string, fileId: string): Promise<string | null> {
  const res = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  if (!res.ok) return null;
  const { ok, result } = (await res.json()) as { ok: boolean; result?: { file_path: string } };
  return ok && result?.file_path ? result.file_path : null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const { TELEGRAM_BOT_TOKEN: token } = serverEnv();
  const sig = searchParams.get("sig");

  let filePath = searchParams.get("path");
  const fileId = searchParams.get("fileId");

  if (fileId) {
    if (!SAFE_FILE_ID.test(fileId)) return new Response("invalid fileId", { status: 400 });
    if (!verifyPhotoSig({ fileId }, sig)) return new Response("forbidden", { status: 403 });
    filePath = await resolveFilePath(token, fileId);
    if (!filePath) return new Response("not found", { status: 404 });
  } else if (filePath) {
    if (!SAFE_PATH.test(filePath)) return new Response("invalid path", { status: 400 });
    if (!verifyPhotoSig({ path: filePath }, sig)) return new Response("forbidden", { status: 403 });
  }

  if (!filePath || !SAFE_PATH.test(filePath)) {
    return new Response("invalid path", { status: 400 });
  }

  const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!res.ok) return new Response("not found", { status: 404 });

  const type = res.headers.get("Content-Type") ?? "";
  return new Response(res.body, {
    headers: {
      "Content-Type": IMAGE_TYPES.test(type) ? type : "image/jpeg",
      "X-Content-Type-Options": "nosniff",
      // private: a receipt must not sit in a shared cache behind a link anyone could replay.
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
