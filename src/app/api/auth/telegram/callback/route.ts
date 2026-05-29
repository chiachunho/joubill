import crypto from "node:crypto";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { sessions } from "@/db/schema";
import { verifyTelegramWidget } from "@/lib/auth/telegramWidget";
import { upsertTelegramUser } from "@/lib/auth/upsertTelegramUser";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  let widgetUser;
  try {
    widgetUser = verifyTelegramWidget(searchParams, serverEnv().TELEGRAM_BOT_TOKEN);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "verification failed" },
      { status: 401 },
    );
  }

  const user = await upsertTelegramUser({
    id: widgetUser.id,
    first_name: widgetUser.first_name,
    last_name: widgetUser.last_name,
    username: widgetUser.username,
    photo_url: widgetUser.photo_url,
  });

  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  await db.insert(sessions).values({ id: sessionId, userId: user.id, expiresAt });

  const cookie = [
    `session=${sessionId}`,
    `Path=/`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
    `Max-Age=${SESSION_SECONDS}`,
  ].join("; ");

  return NextResponse.redirect(new URL("/app", req.url), {
    status: 302,
    headers: { "Set-Cookie": cookie },
  });
}
