import { and, desc, eq, inArray, lt, notInArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { mcpCallLog, mcpConnections } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import {
  CALLS_PAGE_SIZE,
  parseCallCursor,
  parseCallFilter,
  SUCCESS_OUTCOMES,
  WRITE_TOOLS,
} from "@/lib/mcp-call-log";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A connection's recent tool calls, newest first, a page at a time (issue #153). Only the
 * owner's: someone else's connection id answers 404, like the other `/api/me` routes. A revoked
 * connection stays readable, since looking back is the usual reason to revoke it.
 */
export const GET = withAuth(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await getAuth(req);
    const id = requireId((await params).id, "connection id");
    const url = new URL(req.url);

    const filter = url.searchParams.has("filter")
      ? parseCallFilter(url.searchParams.get("filter"))
      : "all";
    if (!filter) return NextResponse.json({ error: "invalid filter" }, { status: 400 });
    const rawCursor = url.searchParams.get("cursor");
    const cursor = rawCursor === null ? null : parseCallCursor(rawCursor);
    if (rawCursor !== null && cursor === null) {
      return NextResponse.json({ error: "invalid cursor" }, { status: 400 });
    }

    const [conn] = await db
      .select({ id: mcpConnections.id })
      .from(mcpConnections)
      .where(and(eq(mcpConnections.id, id), eq(mcpConnections.userId, auth.user.id)));
    if (!conn) return NextResponse.json({ error: "connection not found" }, { status: 404 });

    const rows = await db
      .select({
        id: mcpCallLog.id,
        tool: mcpCallLog.tool,
        groupId: mcpCallLog.groupId,
        outcome: mcpCallLog.outcome,
        recordId: mcpCallLog.recordId,
        durationMs: mcpCallLog.durationMs,
        createdAt: mcpCallLog.createdAt,
      })
      .from(mcpCallLog)
      .where(
        and(
          eq(mcpCallLog.connectionId, id),
          cursor ? lt(mcpCallLog.id, cursor) : undefined,
          filter === "write" ? inArray(mcpCallLog.tool, [...WRITE_TOOLS]) : undefined,
          filter === "failed" ? notInArray(mcpCallLog.outcome, [...SUCCESS_OUTCOMES]) : undefined,
        ),
      )
      .orderBy(desc(mcpCallLog.id))
      .limit(CALLS_PAGE_SIZE + 1);

    const page = rows.slice(0, CALLS_PAGE_SIZE);
    return NextResponse.json({
      calls: page.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      nextCursor: rows.length > CALLS_PAGE_SIZE ? page[page.length - 1].id : null,
    });
  },
);
