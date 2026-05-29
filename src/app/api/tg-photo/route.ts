import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxy Telegram file downloads so the bot token never appears in client-visible URLs.
// File paths look like "photos/file_abc123.jpg" — only allow safe characters.
const SAFE_PATH = /^[A-Za-z0-9/_.-]+$/;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const filePath = searchParams.get("path");

  if (!filePath || !SAFE_PATH.test(filePath)) {
    return new Response("invalid path", { status: 400 });
  }

  const { TELEGRAM_BOT_TOKEN: token } = serverEnv();
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);

  if (!res.ok) return new Response("not found", { status: 404 });

  return new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
