import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { authIdentities, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { canUnlink, isLoginProvider } from "@/lib/identities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REASON_TEXT = {
  last: "這是你最後一個登入方式，不能解除",
  telegram: "Telegram 是帳號的基礎身分，不能解除",
} as const;

export const DELETE = withAuth(
  async (req: Request, { params }: { params: Promise<{ provider: string }> }) => {
    const auth = await getAuth(req);
    const { provider } = await params;
    if (!isLoginProvider(provider)) {
      return NextResponse.json({ error: "未知的登入方式" }, { status: 400 });
    }

    // Locking the user row serialises two unlinks at once: each would otherwise see two
    // methods and delete its own, leaving the account with none.
    const failure = await db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, auth.user.id)).for("update");
      const rows = await tx
        .select({ provider: authIdentities.provider })
        .from(authIdentities)
        .where(eq(authIdentities.userId, auth.user.id));
      const linked = rows.map((r) => r.provider);
      if (!linked.includes(provider)) {
        return NextResponse.json({ error: "沒有綁定這個登入方式" }, { status: 404 });
      }

      const verdict = canUnlink(
        provider,
        // Count distinct methods, not rows, so two rows of one provider can't pass for two methods.
        [...new Set(linked)],
      );
      if (!verdict.ok) {
        return NextResponse.json({ error: REASON_TEXT[verdict.reason] }, { status: 409 });
      }

      await tx
        .delete(authIdentities)
        .where(and(eq(authIdentities.userId, auth.user.id), eq(authIdentities.provider, provider)));
      // An avatar chosen from this login falls back to automatic rather than pointing at nothing.
      await tx
        .update(users)
        .set({ avatarSource: null, updatedAt: new Date() })
        .where(and(eq(users.id, auth.user.id), eq(users.avatarSource, provider)));
      return null;
    });
    if (failure) return failure;
    return NextResponse.json({ ok: true });
  },
);
