import { and, desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { agentConnections } from "@/db/schema";
import { createConnectionSchema, MAX_AGENT_CONNECTIONS } from "@/lib/agent-connection-input";
import { assertMemberOfAll, publicConnectionColumns } from "@/lib/agent-connections-db";
import { generateToken, hashToken, tokenDisplayPrefix } from "@/lib/agent-token";
import { getAuth } from "@/lib/auth";
import { BadRequestError } from "@/lib/auth/errors";
import { withAuth } from "@/lib/auth/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The caller's connections, newest first, never the hash. */
export const GET = withAuth(async (req: Request) => {
  const auth = await getAuth(req);
  const rows = await db
    .select(publicConnectionColumns)
    .from(agentConnections)
    .where(eq(agentConnections.userId, auth.user.id))
    .orderBy(desc(agentConnections.createdAt));
  return NextResponse.json({ connections: rows });
});

/** Creates a personal token. The plaintext is in this response and nowhere else, ever. */
export const POST = withAuth(async (req: Request) => {
  const auth = await getAuth(req);
  const parsed = createConnectionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const groupIds = [...new Set(input.groupIds)];
  if (!input.allGroups) await assertMemberOfAll(auth.user.id, groupIds);

  const live = await db
    .select({ id: agentConnections.id })
    .from(agentConnections)
    .where(and(eq(agentConnections.userId, auth.user.id), isNull(agentConnections.revokedAt)));
  if (live.length >= MAX_AGENT_CONNECTIONS) {
    throw new BadRequestError(`at most ${MAX_AGENT_CONNECTIONS} active connections`);
  }

  const token = generateToken();
  const [row] = await db
    .insert(agentConnections)
    .values({
      userId: auth.user.id,
      kind: "token",
      name: input.name,
      tokenHash: hashToken(token),
      tokenPrefix: tokenDisplayPrefix(token),
      access: input.access,
      allGroups: input.allGroups,
      groupIds: input.allGroups ? [] : groupIds,
      expiresAt: input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null,
    })
    .returning(publicConnectionColumns);
  return NextResponse.json({ connection: row, token }, { status: 201 });
});
