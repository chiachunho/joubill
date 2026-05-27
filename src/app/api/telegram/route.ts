import { webhookCallback } from "grammy";

import { getBot } from "@/bot";
import { serverEnv } from "@/lib/env";

// grammY 需要 Node API（crypto / Buffer）；強制 Node runtime。
export const runtime = "nodejs";
// 不 cache，每次都走 server。
export const dynamic = "force-dynamic";

let _handler: ((req: Request) => Promise<Response>) | undefined;

function handler() {
  if (_handler) return _handler;
  _handler = webhookCallback(getBot(), "std/http", {
    secretToken: serverEnv().TELEGRAM_WEBHOOK_SECRET,
  });
  return _handler;
}

export async function POST(req: Request) {
  return handler()(req);
}
