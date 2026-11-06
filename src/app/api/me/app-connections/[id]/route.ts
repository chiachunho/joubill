import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { appConnections } from "@/db/schema";
import { updateConnectionSchema } from "@/lib/app-connection-input";
import { assertMemberOfAll, publicConnectionColumns } from "@/lib/app-connections-db";
import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Revokes a connection: it stops working at once, and its row stays for the audit log. */
export const DELETE = withAuth(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await getAuth(req);
    const id = requireId((await params).id, "connection id");
    const revoked = await db
      .update(appConnections)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(appConnections.id, id),
          eq(appConnections.userId, auth.user.id),
          isNull(appConnections.revokedAt),
        ),
      )
      .returning({ id: appConnections.id });
    if (revoked.length === 0) {
      return NextResponse.json({ error: "connection not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  },
);

/**
 * Changes a live connection's permission and group scope. The token, name and expiry stay as
 * they were. A revoked connection is not editable; an expired one is, since the owner may be
 * tidying it before deleting it. Any change takes effect on the connection's next call.
 */
export const PATCH = withAuth(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await getAuth(req);
    const id = requireId((await params).id, "connection id");
    const parsed = updateConnectionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const input = parsed.data;

    const groupIds = [...new Set(input.groupIds ?? [])];
    if (input.allGroups === false) await assertMemberOfAll(auth.user.id, groupIds);

    const [row] = await db
      .update(appConnections)
      .set({
        ...(input.access ? { access: input.access } : {}),
        ...(input.allGroups !== undefined
          ? { allGroups: input.allGroups, groupIds: input.allGroups ? [] : groupIds }
          : {}),
      })
      .where(
        and(
          eq(appConnections.id, id),
          eq(appConnections.userId, auth.user.id),
          isNull(appConnections.revokedAt),
        ),
      )
      .returning(publicConnectionColumns);
    if (!row) return NextResponse.json({ error: "connection not found" }, { status: 404 });
    return NextResponse.json({ connection: row });
  },
);
