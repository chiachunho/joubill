import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { db } from "@/db";
import { expenses } from "@/db/schema";
import type { McpAuth } from "@/lib/auth/mcp";
import { HttpError } from "@/lib/auth/errors";
import { carryOverPayers, carryOverSplit, sameInstantIso } from "@/lib/mcp-edit";
import { parseMcpAmount } from "@/lib/mcp-amount";
import { buildExpenseInput, type McpPayer } from "@/lib/mcp-split";
import { deleteRecord, updateExpense, updateSettlement } from "@/lib/records";
import { daySchema, idSchema, settlementInputSchema, SUPPORTED_CURRENCIES } from "@/lib/zod";

import { openGroup } from "../context";
import { guarded, ok, ToolError } from "../result";
import { loadMcpRecords } from "./records";
import {
  makeResolver,
  mcpActor,
  memberRef,
  resolveCurrency,
  splitSchema,
  toMcpSplit,
} from "./write";

const EDIT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const DELETE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

type Stored = Awaited<ReturnType<typeof loadMcpRecords>>[number];

/** Loads the record or answers not_found, so every edit starts from what is stored now. */
async function loadOne(groupId: number, recordId: number, labels: Map<number, string>) {
  const [record] = await loadMcpRecords(groupId, [recordId], labels);
  if (!record) throw new ToolError("not_found", "record not found");
  return record;
}

/** A 409 from the records layer, with the record as it is now so the agent can reconcile. */
async function asConflict(
  err: unknown,
  groupId: number,
  recordId: number,
  labels: Map<number, string>,
): Promise<never> {
  if (err instanceof HttpError && err.status === 409) {
    throw new ToolError("conflict", err.message, {
      current: await loadOne(groupId, recordId, labels).catch(() => null),
    });
  }
  throw err;
}

export function registerEditTools(server: McpServer, auth: McpAuth) {
  server.registerTool(
    "update_record",
    {
      title: "Update record",
      description:
        "Change an existing expense or settlement. Only the fields you send change; everything else is kept (an unchanged split follows a new amount). Read the record with get_record first and send its updatedAt as expectedUpdatedAt: if someone changed the record since, nothing is written and you get conflict with the current record, so ask the user before retrying. Call with dryRun: true first and confirm with the user. Expense fields: amount ('1,200', '150+200'), currency, description, spentAt (YYYY-MM-DD in the group's time zone), paidBy or payers, split. Settlement fields: amount, currency, spentAt, from, to. People are memberId (preferred) or an exact name; a miss or tie writes nothing and returns the candidates. If the amount changes on a record with several payers or a per-person split, send payers / split too.",
      inputSchema: {
        groupId: idSchema,
        recordId: idSchema,
        expectedUpdatedAt: z
          .string()
          .trim()
          .min(10)
          .max(40)
          .describe("The updatedAt of the record as you last read it (get_record)."),
        amount: z
          .union([z.number().positive().max(10_000_000), z.string().min(1).max(60)])
          .optional(),
        currency: z.enum(SUPPORTED_CURRENCIES).optional(),
        description: z.string().trim().max(500).optional().describe("Empty text clears it."),
        spentAt: daySchema.optional().describe("YYYY-MM-DD in the group's time zone."),
        paidBy: memberRef.optional().describe("Expense only: a single payer."),
        payers: z
          .array(z.object({ member: memberRef, amount: z.number().positive() }))
          .min(1)
          .max(20)
          .optional()
          .describe("Expense only: several payers adding up to the total."),
        split: splitSchema.optional().describe("Expense only: who owes what."),
        from: memberRef.optional().describe("Settlement only: who paid."),
        to: memberRef.optional().describe("Settlement only: who received."),
        dryRun: z.boolean().optional().describe("Preview only: nothing is written."),
      },
      annotations: EDIT,
    },
    (args) =>
      guarded(async () => {
        const { group, members, labels } = await openGroup(auth, args.groupId, "write", {
          countAs: args.dryRun ? "read" : "write",
        });
        const cur = await loadOne(args.groupId, args.recordId, labels);
        if (!sameInstantIso(cur.updatedAt, args.expectedUpdatedAt)) {
          throw new ToolError("conflict", "the record was changed after it was read", {
            current: cur,
          });
        }
        const expected = new Date(args.expectedUpdatedAt);
        if (Number.isNaN(expected.getTime())) {
          throw new ToolError("bad_request", "expectedUpdatedAt is not a timestamp");
        }
        const find = makeResolver(members, auth.user.id);

        const parsed = args.amount !== undefined ? parseMcpAmount(args.amount) : null;
        if (parsed && !parsed.ok) throw new ToolError("bad_request", parsed.message);
        const amount = parsed?.ok ? parsed.amount : cur.amount;
        const amountChanged = Math.round(amount * 100) !== Math.round(cur.amount * 100);
        const currency = resolveCurrency(
          args.currency,
          parsed?.ok ? parsed.currency : null,
          cur.currency,
        );
        const spentAt = args.spentAt ?? cur.spentAt;

        // A pinned rate belongs to the currency it was pinned for.
        const [fxRow] = await db
          .select({ fxRate: expenses.fxRate, fxQuote: expenses.fxQuote })
          .from(expenses)
          .where(and(eq(expenses.id, args.recordId), eq(expenses.groupId, args.groupId)));
        const fxRate =
          fxRow?.fxRate != null &&
          fxRow.fxQuote === group.defaultCurrency &&
          currency === cur.currency
            ? Number(fxRow.fxRate)
            : null;

        const label = (id: number) => labels.get(id) ?? "?";
        const actor = mcpActor(auth);

        if (cur.type === "settlement") {
          if (
            args.paidBy !== undefined ||
            args.payers ||
            args.split ||
            args.description !== undefined
          ) {
            throw new ToolError(
              "bad_request",
              "this record is a settlement: use from / to instead of paidBy, payers, split or description",
            );
          }
          const fromId = args.from !== undefined ? find(args.from).id : cur.payers[0].memberId;
          const toId = args.to !== undefined ? find(args.to).id : cur.splits[0].memberId;
          if (fromId === toId) throw new ToolError("bad_request", "from and to must differ");
          const input = settlementInputSchema.safeParse({
            fromUserId: fromId,
            toUserId: toId,
            amount,
            currency,
            fxRate,
            settledAt: spentAt,
          });
          if (!input.success) throw new ToolError("bad_request", input.error.issues[0].message);
          const after = {
            from: { memberId: fromId, label: label(fromId) },
            to: { memberId: toId, label: label(toId) },
            amount,
            currency,
            spentAt,
          };
          if (args.dryRun)
            return ok("dry run: nothing written", { status: "dry_run", before: cur, after });
          try {
            await updateSettlement(
              args.groupId,
              args.recordId,
              input.data,
              { actor },
              {
                expectedUpdatedAt: expected,
              },
            );
          } catch (err) {
            await asConflict(err, args.groupId, args.recordId, labels);
          }
        } else {
          if (args.from !== undefined || args.to !== undefined) {
            throw new ToolError(
              "bad_request",
              "this record is an expense: use paidBy / payers instead of from / to",
            );
          }
          if (args.payers && args.paidBy !== undefined) {
            throw new ToolError("bad_request", "use paidBy or payers, not both");
          }
          let payers: McpPayer[];
          if (args.payers) {
            payers = args.payers.map((p) => ({ userId: find(p.member).id, amount: p.amount }));
          } else if (args.paidBy !== undefined) {
            payers = [{ userId: find(args.paidBy).id }];
          } else {
            const kept = carryOverPayers(cur.payers, amountChanged);
            if (!kept.ok) throw new ToolError("bad_request", kept.message);
            payers = kept.value;
          }
          let split;
          if (args.split) {
            split = toMcpSplit(args.split, find, members);
          } else {
            const kept = carryOverSplit(cur.splits, amountChanged);
            if (!kept.ok) throw new ToolError("bad_request", kept.message);
            split = kept.value;
          }
          const description =
            args.description !== undefined ? args.description || null : cur.description;
          const built = buildExpenseInput({
            amount,
            currency,
            description,
            spentAt,
            payers,
            split,
            fxRate,
          });
          if (!built.ok) throw new ToolError("bad_request", built.message);
          const after = {
            amount: built.input.amount,
            currency,
            description: built.input.description,
            spentAt,
            shareType: built.input.shareType,
            payers: built.input.payers.map((p) => ({
              memberId: p.payerId,
              label: label(p.payerId),
              amount: p.amount,
            })),
            splits: built.input.splits.map((s) => ({
              memberId: s.debtorId,
              label: label(s.debtorId),
              amount: s.amount,
            })),
          };
          if (args.dryRun)
            return ok("dry run: nothing written", { status: "dry_run", before: cur, after });
          try {
            await updateExpense(
              args.groupId,
              args.recordId,
              built.input,
              { actor },
              {
                expectedUpdatedAt: expected,
              },
            );
          } catch (err) {
            await asConflict(err, args.groupId, args.recordId, labels);
          }
        }

        const record: Stored = await loadOne(args.groupId, args.recordId, labels);
        return ok(`updated record ${args.recordId}`, {
          status: "updated",
          recordId: args.recordId,
          record,
        });
      }),
  );

  server.registerTool(
    "delete_record",
    {
      title: "Delete record",
      description:
        "Permanently delete an expense or settlement. This cannot be undone and the group chat shows who deleted it. Only do it when the user clearly asked: call with dryRun: true first, show the user the record that would go and wait for their explicit confirmation. Use get_record or list_records to find the recordId.",
      inputSchema: {
        groupId: idSchema,
        recordId: idSchema,
        dryRun: z.boolean().optional().describe("Preview only: shows the record, deletes nothing."),
      },
      annotations: DELETE,
    },
    (args) =>
      guarded(async () => {
        const { labels } = await openGroup(auth, args.groupId, "write", {
          countAs: args.dryRun ? "read" : "write",
        });
        const record = await loadOne(args.groupId, args.recordId, labels);
        if (args.dryRun) {
          return ok("dry run: nothing deleted", { status: "dry_run", wouldDelete: record });
        }
        await deleteRecord(
          args.groupId,
          args.recordId,
          record.type === "settlement" ? "settlement" : "expense",
          auth.user,
          { actor: mcpActor(auth) },
        );
        return ok(`deleted record ${args.recordId}`, {
          status: "deleted",
          recordId: args.recordId,
          deleted: record,
        });
      }),
  );
}
