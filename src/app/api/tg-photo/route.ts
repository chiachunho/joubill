import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxy Telegram file downloads so the bot token never appears in client-visible URLs.
const SAFE_PATH = /^[A-Za-z0-9/_.-]+$/;
const SAFE_FILE_ID = /^[A-Za-z0-9_-]+$/;

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

  let filePath = searchParams.get("path");
  const fileId = searchParams.get("fileId");

  if (fileId) {
    if (!SAFE_FILE_ID.test(fileId)) return new Response("invalid fileId", { status: 400 });
    filePath = await resolveFilePath(token, fileId);
    if (!filePath) return new Response("not found", { status: 404 });
  }

  if (!filePath || !SAFE_PATH.test(filePath)) {
    return new Response("invalid path", { status: 400 });
  }

  const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!res.ok) return new Response("not found", { status: 404 });

  return new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
