import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sessions } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function POST(req: Request) {
  const token = parseCookie(req.headers.get("cookie") ?? "", "session");
  if (token) {
    await db.delete(sessions).where(eq(sessions.id, token));
  }
  const cleared = "session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
  return new Response(null, { status: 204, headers: { "Set-Cookie": cleared } });
}
