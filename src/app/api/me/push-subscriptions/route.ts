import { and, count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import type { PushSubscriptionsResponse } from "@/lib/api-types";
import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { pushConfigured } from "@/lib/push";
import { pushEndpointSchema, pushSubscriptionSchema } from "@/lib/zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether push is set up on this server, and how many of the caller's devices receive it. */
export const GET = withAuth(async (req: Request) => {
  const auth = await getAuth(req);
  const [row] = await db
    .select({ n: count() })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, auth.user.id));
  const body: PushSubscriptionsResponse = { configured: pushConfigured(), count: row?.n ?? 0 };
  return NextResponse.json(body);
});

/**
 * Saves this device's subscription for the caller. Idempotent, and also run whenever the
 * settings page finds the browser already subscribed, so the server's copy heals after a
 * 410 cleanup. `endpoint` is unique: a device that signs in as someone else takes the row
 * over, so it stops receiving the previous account's notifications.
 */
export const POST = withAuth(async (req: Request) => {
  const auth = await getAuth(req);
  if (!pushConfigured()) {
    return NextResponse.json({ error: "這個站台沒有開放推播通知" }, { status: 503 });
  }
  const parsed = pushSubscriptionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "格式錯誤" }, { status: 400 });

  const { endpoint, keys } = parsed.data;
  const userAgent = req.headers.get("user-agent")?.slice(0, 512) ?? null;
  await db
    .insert(pushSubscriptions)
    .values({ userId: auth.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: auth.user.id, p256dh: keys.p256dh, auth: keys.auth, userAgent },
    });
  return NextResponse.json({ ok: true });
});

/** Stops push to one of the caller's devices. Someone else's endpoint is left alone. */
export const DELETE = withAuth(async (req: Request) => {
  const auth = await getAuth(req);
  const parsed = pushEndpointSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "格式錯誤" }, { status: 400 });

  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, auth.user.id),
        eq(pushSubscriptions.endpoint, parsed.data.endpoint),
      ),
    );
  return NextResponse.json({ ok: true });
});
