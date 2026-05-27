import { webhookCallback } from "grammy";

import { getBot } from "@/bot";
import { serverEnv } from "@/lib/env";

// grammY uses Node APIs (crypto / Buffer); force the Node runtime.
export const runtime = "nodejs";
// Always hit the server — webhook payloads must not be cached.
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
