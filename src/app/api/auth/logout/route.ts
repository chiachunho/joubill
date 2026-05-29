import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sessions } from "@/db/schema";
import { parseCookie, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = parseCookie(req.headers.get("cookie") ?? "", SESSION_COOKIE);
  if (token) {
    await db.delete(sessions).where(eq(sessions.id, token));
  }
  const cleared = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  return new Response(null, { status: 204, headers: { "Set-Cookie": cleared } });
}
