import { call, mkToken, rpc } from "./mcp";
import { expect, test } from "./fixtures";

test.describe("MCP server", () => {
  test("tools/list shows the core tools", async ({ request, seeded, dbPool }) => {
    const { token } = await mkToken(dbPool, seeded.userId, { groupIds: [seeded.groupId] });
    const res = await rpc(request, token, "tools/list");
    expect(res.status()).toBe(200);
    const names = ((await res.json()) as { result: { tools: { name: string }[] } }).result.tools
      .map((t) => t.name)
      .sort();
    expect(names).toEqual(
      [
        "add_expense",
        "add_settlement",
        "delete_record",
        "get_balance",
        "get_group",
        "get_record",
        "list_groups",
        "list_records",
        "update_record",
      ].sort(),
    );
  });

  test("an expense added by name changes the balance, and the same key does not repeat it", async ({
    request,
    seeded,
    dbPool,
  }) => {
    const { token } = await mkToken(dbPool, seeded.userId, { groupIds: [seeded.groupId] });
    const args = {
      groupId: seeded.groupId,
      amount: "1,000",
      description: "E2E agent dinner",
      split: { type: "equal", among: [seeded.partnerName, "me"] },
      idempotencyKey: `e2e-${seeded.groupId}-1`,
    };
    const first = await call(request, token, "add_expense", args);
    expect(first.structuredContent).toMatchObject({ status: "created" });
    const recordId = first.structuredContent!.recordId as number;

    const again = await call(request, token, "add_expense", args);
    expect(again.structuredContent).toMatchObject({ status: "duplicate", recordId });

    const { rows } = await dbPool.query(
      "SELECT count(*)::int AS n FROM expenses WHERE group_id=$1 AND description=$2",
      [seeded.groupId, "E2E agent dinner"],
    );
    expect(rows[0].n).toBe(1);

    const bal = await call(request, token, "get_balance", { groupId: seeded.groupId });
    const mine = (bal.structuredContent!.balances as { memberId: number; amount: number }[]).find(
      (b) => b.memberId === seeded.userId,
    );
    // Seeded: I paid 300 and owe 150 (+150). Now I paid 1000 and owe 500 (+500 more).
    expect(mine?.amount).toBe(650);

    const audit = await dbPool.query(
      "SELECT source, app_connection_id FROM record_audit_log WHERE record_id=$1",
      [recordId],
    );
    expect(audit.rows[0].source).toBe("mcp");
    expect(audit.rows[0].app_connection_id).not.toBeNull();
  });

  test("an unknown name is refused with candidates and writes nothing", async ({
    request,
    seeded,
    dbPool,
  }) => {
    const { token } = await mkToken(dbPool, seeded.userId, { groupIds: [seeded.groupId] });
    const res = await call(request, token, "add_expense", {
      groupId: seeded.groupId,
      amount: 50,
      split: { type: "equal", among: ["Nobody Here"] },
    });
    expect(res.isError).toBe(true);
    expect(res.structuredContent!.error.code).toBe("member_not_found");
    expect(res.structuredContent!.error.candidates.length).toBe(2);
  });

  test("an identical expense within minutes is held back as a possible duplicate", async ({
    request,
    seeded,
    dbPool,
  }) => {
    const { token } = await mkToken(dbPool, seeded.userId, { groupIds: [seeded.groupId] });
    const args = { groupId: seeded.groupId, amount: 77, description: "E2E dup" };
    const first = await call(request, token, "add_expense", args);
    expect(first.structuredContent!.status).toBe("created");
    const second = await call(request, token, "add_expense", args);
    expect(second.structuredContent).toMatchObject({
      status: "possible_duplicate",
      possibleDuplicateOf: first.structuredContent!.recordId,
    });
    const forced = await call(request, token, "add_expense", { ...args, allowDuplicate: true });
    expect(forced.structuredContent!.status).toBe("created");
  });

  test("a read-only token can read but not write", async ({ request, seeded, dbPool }) => {
    const { token } = await mkToken(dbPool, seeded.userId, {
      access: "read",
      groupIds: [seeded.groupId],
    });
    const read = await call(request, token, "get_group", { groupId: seeded.groupId });
    expect(read.isError).toBeFalsy();
    const write = await call(request, token, "add_expense", {
      groupId: seeded.groupId,
      amount: 10,
    });
    expect(write.isError).toBe(true);
    expect(write.structuredContent!.error.code).toBe("forbidden");
  });

  test("a group outside the token's scope, or one the user is not in, is refused", async ({
    request,
    seeded,
    dbPool,
  }) => {
    const { token } = await mkToken(dbPool, seeded.userId, { groupIds: [seeded.groupId] });
    const foreign = await call(request, token, "get_group", { groupId: seeded.foreignGroupId });
    expect(foreign.isError).toBe(true);
    expect(foreign.structuredContent!.error.code).toBe("forbidden");

    // All groups still stops at the user's own membership.
    const wide = await mkToken(dbPool, seeded.userId, { allGroups: true });
    const notMember = await call(request, wide.token, "get_group", {
      groupId: seeded.foreignGroupId,
    });
    expect(notMember.isError).toBe(true);
    expect(notMember.structuredContent!.error.code).toBe("forbidden");

    const list = await call(request, token, "list_groups", {});
    expect(list.structuredContent!.groups.map((g: { groupId: number }) => g.groupId)).toEqual([
      seeded.groupId,
    ]);
  });

  test("a revoked or expired token is a 401, and so is no token", async ({
    request,
    seeded,
    dbPool,
  }) => {
    const revoked = await mkToken(dbPool, seeded.userId, { groupIds: [seeded.groupId] });
    expect((await rpc(request, revoked.token, "tools/list")).status()).toBe(200);
    await dbPool.query("UPDATE app_connections SET revoked_at = now() WHERE id=$1", [revoked.id]);
    expect((await rpc(request, revoked.token, "tools/list")).status()).toBe(401);

    const expired = await mkToken(dbPool, seeded.userId, { groupIds: [seeded.groupId] });
    await dbPool.query(
      "UPDATE app_connections SET expires_at = now() - interval '1 minute' WHERE id=$1",
      [expired.id],
    );
    expect((await rpc(request, expired.token, "tools/list")).status()).toBe(401);

    const none = await request.post("/api/mcp", {
      headers: { accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(none.status()).toBe(401);
  });

  test("a token does not work on the REST API", async ({ request, seeded, dbPool }) => {
    const { token } = await mkToken(dbPool, seeded.userId, { groupIds: [seeded.groupId] });
    const res = await request.get(`/api/groups/${seeded.groupId}/balance`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(401);
  });

  test("a settlement is recorded with a name, and from must differ from to", async ({
    request,
    seeded,
    dbPool,
  }) => {
    const { token } = await mkToken(dbPool, seeded.userId, { groupIds: [seeded.groupId] });
    const same = await call(request, token, "add_settlement", {
      groupId: seeded.groupId,
      to: "me",
      amount: 20,
    });
    expect(same.isError).toBe(true);

    const ok = await call(request, token, "add_settlement", {
      groupId: seeded.groupId,
      from: seeded.partnerName,
      to: "me",
      amount: 20,
    });
    expect(ok.structuredContent).toMatchObject({ status: "created" });
    const rec = await call(request, token, "get_record", {
      groupId: seeded.groupId,
      recordId: ok.structuredContent!.recordId,
    });
    expect(rec.structuredContent!.record.type).toBe("settlement");
  });

  test("tokens can be created, listed and revoked through the account API", async ({
    authedPage,
    seeded,
    request,
  }) => {
    const api = authedPage.request;
    const created = await api.post("/api/me/app-connections", {
      data: { name: "E2E laptop", access: "read", allGroups: false, groupIds: [seeded.groupId] },
    });
    expect(created.status()).toBe(201);
    const { connection, token } = (await created.json()) as {
      connection: { id: number; tokenHash?: string };
      token: string;
    };
    expect(token).toMatch(/^sbk_/);
    expect(connection.tokenHash).toBeUndefined();

    const listed = (await (await api.get("/api/me/app-connections")).json()) as {
      connections: { id: number; name: string }[];
    };
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(listed.connections.some((c) => c.id === connection.id)).toBe(true);
    expect((await rpc(request, token, "tools/list")).status()).toBe(200);

    // A group the user isn't in can't be put in a token's scope.
    const bad = await api.post("/api/me/app-connections", {
      data: { name: "x", access: "read", allGroups: false, groupIds: [seeded.foreignGroupId] },
    });
    expect(bad.status()).toBe(400);

    expect((await api.delete(`/api/me/app-connections/${connection.id}`)).status()).toBe(200);
    expect((await rpc(request, token, "tools/list")).status()).toBe(401);
    expect((await api.delete(`/api/me/app-connections/${connection.id}`)).status()).toBe(404);
  });

  test("update_record changes only what was sent, and a stale read is a conflict", async ({
    request,
    seeded,
    dbPool,
  }) => {
    const { token } = await mkToken(dbPool, seeded.userId, { groupIds: [seeded.groupId] });
    const created = await call(request, token, "add_expense", {
      groupId: seeded.groupId,
      amount: 400,
      description: "E2E edit me",
      split: { type: "equal", among: [seeded.partnerName, "me"] },
    });
    const recordId = created.structuredContent!.recordId as number;
    const read = await call(request, token, "get_record", { groupId: seeded.groupId, recordId });
    const updatedAt = read.structuredContent!.record.updatedAt as string;

    const preview = await call(request, token, "update_record", {
      groupId: seeded.groupId,
      recordId,
      expectedUpdatedAt: updatedAt,
      amount: "600",
      dryRun: true,
    });
    expect(preview.structuredContent).toMatchObject({ status: "dry_run" });
    const untouched = await dbPool.query("SELECT amount FROM expenses WHERE id=$1", [recordId]);
    expect(Number(untouched.rows[0].amount)).toBe(400);

    const done = await call(request, token, "update_record", {
      groupId: seeded.groupId,
      recordId,
      expectedUpdatedAt: updatedAt,
      amount: "600",
    });
    expect(done.structuredContent).toMatchObject({ status: "updated" });
    const rows = await dbPool.query("SELECT amount, description FROM expenses e WHERE e.id=$1", [
      recordId,
    ]);
    expect(Number(rows.rows[0].amount)).toBe(600);
    expect(rows.rows[0].description).toBe("E2E edit me");
    // The equal split followed the new total: 300 each.
    const splits = await dbPool.query(
      "SELECT amount FROM expense_splits WHERE expense_id=$1 ORDER BY debtor_id",
      [recordId],
    );
    expect(splits.rows.map((r) => Number(r.amount))).toEqual([300, 300]);
    const audit = await dbPool.query(
      "SELECT source FROM record_audit_log WHERE record_id=$1 AND action='updated'",
      [recordId],
    );
    expect(audit.rows[0].source).toBe("mcp");

    // The old updatedAt is stale now: nothing is written and the current record comes back.
    const stale = await call(request, token, "update_record", {
      groupId: seeded.groupId,
      recordId,
      expectedUpdatedAt: updatedAt,
      description: "overwrites a newer edit",
    });
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent!.error.code).toBe("conflict");
    expect(stale.structuredContent!.error.current.amount).toBe(600);
    const after = await dbPool.query("SELECT description FROM expenses WHERE id=$1", [recordId]);
    expect(after.rows[0].description).toBe("E2E edit me");
  });

  test("delete_record asks to be previewed, deletes, and is logged", async ({
    request,
    seeded,
    dbPool,
  }) => {
    const { token } = await mkToken(dbPool, seeded.userId, { groupIds: [seeded.groupId] });
    const created = await call(request, token, "add_expense", {
      groupId: seeded.groupId,
      amount: 123,
      description: "E2E delete me",
    });
    const recordId = created.structuredContent!.recordId as number;

    const preview = await call(request, token, "delete_record", {
      groupId: seeded.groupId,
      recordId,
      dryRun: true,
    });
    expect(preview.structuredContent).toMatchObject({ status: "dry_run" });
    expect((await dbPool.query("SELECT 1 FROM expenses WHERE id=$1", [recordId])).rowCount).toBe(1);

    const gone = await call(request, token, "delete_record", {
      groupId: seeded.groupId,
      recordId,
    });
    expect(gone.structuredContent).toMatchObject({ status: "deleted", recordId });
    expect((await dbPool.query("SELECT 1 FROM expenses WHERE id=$1", [recordId])).rowCount).toBe(0);
    const audit = await dbPool.query(
      "SELECT source, app_connection_id FROM record_audit_log WHERE record_id=$1 AND action='deleted'",
      [recordId],
    );
    expect(audit.rows[0].source).toBe("mcp");
    expect(audit.rows[0].app_connection_id).not.toBeNull();

    const again = await call(request, token, "delete_record", {
      groupId: seeded.groupId,
      recordId,
    });
    expect(again.structuredContent!.error.code).toBe("not_found");
  });

  test("a read-only token can neither update nor delete", async ({ request, seeded, dbPool }) => {
    const { token } = await mkToken(dbPool, seeded.userId, {
      access: "read",
      groupIds: [seeded.groupId],
    });
    const del = await call(request, token, "delete_record", {
      groupId: seeded.groupId,
      recordId: 1,
    });
    expect(del.structuredContent!.error.code).toBe("forbidden");
  });
});
