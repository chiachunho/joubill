import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { db } from "@/db";
import { expensePayers, expenses } from "@/db/schema";
import { parseMcpAmount } from "@/lib/mcp-amount";
import { bindKey, claimKey, duplicateSince, releaseKey } from "@/lib/mcp-idempotency";
import { describeUnresolved, resolveMember } from "@/lib/mcp-names";
import { buildExpenseInput, type McpPayer, type McpSplit } from "@/lib/mcp-split";
import type { AppAuth } from "@/lib/auth/mcp";
import { todayIn } from "@/lib/day";
import { createExpense, createSettlement } from "@/lib/records";
import {
  daySchema,
  idSchema,
  settlementInputSchema,
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from "@/lib/zod";

import { openGroup, type McpMember } from "../context";
import { guarded, ok, ToolError } from "../result";

const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

export const memberRef = z
  .union([idSchema, z.string().trim().min(1).max(100)])
  .describe("a memberId from get_group (preferred), or a name / @username in this group");
const keySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .optional()
  .describe("Send the same key when retrying so the record is not created twice (kept 24 h).");

const ME_WORDS = new Set(["me", "myself", "self", "我", "本人"]);

export function makeResolver(members: McpMember[], meId: number) {
  return (ref: number | string): McpMember => {
    if (typeof ref === "string" && ME_WORDS.has(ref.trim().toLowerCase())) {
      const me = members.find((m) => m.id === meId);
      if (me) return me;
    }
    const r = resolveMember(ref, members);
    if (r.ok) return r.member;
    throw new ToolError(r.code, describeUnresolved(r.code, r.query, r.candidates), {
      candidates: r.candidates,
    });
  };
}

export const splitSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("equal"),
    among: z.array(memberRef).min(1).max(50).optional().describe("Default: every active member."),
  }),
  z.object({
    type: z.literal("shares"),
    shares: z
      .array(z.object({ member: memberRef, weight: z.number().positive().max(1000) }))
      .min(1)
      .max(50),
  }),
  z.object({
    type: z.literal("exact"),
    amounts: z
      .array(z.object({ member: memberRef, amount: z.number().nonnegative() }))
      .min(1)
      .max(50),
  }),
]);

type SplitArg = z.infer<typeof splitSchema>;

/** The agent's split argument with every person resolved to a member id. */
export function toMcpSplit(
  split: SplitArg,
  find: (ref: number | string) => McpMember,
  members: McpMember[],
): McpSplit {
  if (split.type === "equal") {
    return {
      type: "equal",
      userIds: split.among
        ? split.among.map((r) => find(r).id)
        : members.filter((m) => m.active).map((m) => m.id),
    };
  }
  if (split.type === "shares") {
    return {
      type: "shares",
      shares: split.shares.map((s) => ({ userId: find(s.member).id, weight: s.weight })),
    };
  }
  return {
    type: "exact",
    amounts: split.amounts.map((s) => ({ userId: find(s.member).id, amount: s.amount })),
  };
}

/** The currency of a call: the argument, else one written into the amount, else the group's. */
export function resolveCurrency(
  explicit: SupportedCurrency | undefined,
  fromAmount: SupportedCurrency | null,
  groupDefault: string,
): SupportedCurrency {
  if (fromAmount && explicit && fromAmount !== explicit) {
    throw new ToolError("bad_request", "currency in amount conflicts with the currency argument");
  }
  const currency = explicit ?? fromAmount ?? groupDefault;
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
    throw new ToolError("bad_request", `unsupported currency ${currency}`);
  }
  return currency as SupportedCurrency;
}

export const mcpActor = (auth: AppAuth) => ({
  userId: auth.user.id,
  source: "mcp" as const,
  appConnectionId: auth.grant.connectionId,
});

type Reservation = { release: () => Promise<void>; bind: (id: number) => Promise<void> };

/** Handles `idempotencyKey`; returns an early result for a repeat, else a reservation. */
async function reserve(auth: AppAuth, key: string | undefined) {
  if (!key) return { reservation: null as Reservation | null };
  const connId = auth.grant.connectionId;
  const claim = await claimKey(connId, key);
  if (claim.status === "duplicate") {
    return {
      early: ok(`duplicate of record ${claim.recordId}`, {
        status: "duplicate",
        recordId: claim.recordId,
      }),
    };
  }
  if (claim.status === "in_progress") {
    throw new ToolError("in_progress", "a call with this idempotencyKey is still running");
  }
  return {
    reservation: {
      release: () => releaseKey(connId, key),
      bind: (id: number) => bindKey(connId, key, id),
    } satisfies Reservation,
  };
}

export function registerWriteTools(server: McpServer, auth: AppAuth) {
  server.registerTool(
    "add_expense",
    {
      title: "Add expense",
      description:
        "Record a new expense the user paid for (not a repayment between members: use add_settlement). Call with dryRun: true first, show the user the preview, and only write after they confirm. amount is a number or text such as '1,200', '$300', '3k' or '150+200'. Defaults: payer is the user (paidBy / payers to change it), split is equal among all active members (split to change it), currency is the group's default, date is today in the group's time zone. People are given as memberId (preferred) or an exact name; a name that matches nobody or several members writes nothing and returns the candidates, so ask the user. If an identical expense (same amount, currency and payer) was recorded in the last 10 minutes, nothing is written and possibleDuplicateOf is returned: ask the user, and resend with allowDuplicate: true only if it is intended. Send an idempotencyKey so a retry does not record it twice.",
      inputSchema: {
        groupId: idSchema,
        amount: z.union([z.number().positive().max(10_000_000), z.string().min(1).max(60)]),
        currency: z
          .enum(SUPPORTED_CURRENCIES)
          .optional()
          .describe("Default: the group's default currency."),
        description: z.string().trim().max(500).optional(),
        spentAt: daySchema
          .optional()
          .describe("YYYY-MM-DD in the group's time zone. Default: today there."),
        paidBy: memberRef.optional().describe("Single payer, default me."),
        payers: z
          .array(z.object({ member: memberRef, amount: z.number().positive() }))
          .min(1)
          .max(20)
          .optional()
          .describe("Several payers with amounts adding up to the total (instead of paidBy)."),
        split: splitSchema.optional(),
        idempotencyKey: keySchema,
        dryRun: z.boolean().optional(),
        allowDuplicate: z.boolean().optional(),
      },
      annotations: WRITE,
    },
    (args) =>
      guarded(async () => {
        const { group, members, labels } = await openGroup(auth, args.groupId, "write", {
          countAs: args.dryRun ? "read" : "write",
        });
        const find = makeResolver(members, auth.user.id);

        const parsed = parseMcpAmount(args.amount);
        if (!parsed.ok) throw new ToolError("bad_request", parsed.message);
        const currency = resolveCurrency(args.currency, parsed.currency, group.defaultCurrency);
        const spentAt = args.spentAt ?? todayIn(group.timezone);

        if (args.payers && args.paidBy !== undefined) {
          throw new ToolError("bad_request", "use paidBy or payers, not both");
        }
        const payers: McpPayer[] = args.payers
          ? args.payers.map((p) => ({ userId: find(p.member).id, amount: p.amount }))
          : [{ userId: args.paidBy !== undefined ? find(args.paidBy).id : auth.user.id }];

        const mcpSplit = toMcpSplit(args.split ?? { type: "equal" as const }, find, members);

        const built = buildExpenseInput({
          amount: parsed.amount,
          currency,
          description: args.description || null,
          spentAt,
          payers,
          split: mcpSplit,
        });
        if (!built.ok) throw new ToolError("bad_request", built.message);

        const label = (id: number) => labels.get(id) ?? "?";
        const preview = {
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
        if (args.dryRun) return ok("dry run: nothing written", { status: "dry_run", preview });

        const held = await reserve(auth, args.idempotencyKey);
        if (held.early) return held.early;
        const reservation = held.reservation;

        try {
          if (!args.allowDuplicate && built.input.payers.length === 1) {
            const [dup] = await db
              .select({ id: expenses.id })
              .from(expenses)
              .innerJoin(expensePayers, eq(expensePayers.expenseId, expenses.id))
              .where(
                and(
                  eq(expenses.groupId, args.groupId),
                  eq(expenses.type, "expense"),
                  eq(expenses.amount, built.input.amount.toFixed(2)),
                  eq(expenses.currency, currency),
                  eq(expensePayers.payerId, built.input.payers[0].payerId),
                  gte(expenses.createdAt, duplicateSince(new Date())),
                ),
              )
              .limit(1);
            if (dup) {
              await reservation?.release();
              return ok(`possible duplicate of record ${dup.id}; nothing written`, {
                status: "possible_duplicate",
                possibleDuplicateOf: dup.id,
                preview,
              });
            }
          }
          const { id } = await createExpense(args.groupId, built.input, {
            actor: mcpActor(auth),
          });
          // The record exists now: a failed bind must not free the key, or a retry would
          // book it twice.
          await reservation?.bind(id).catch((err) => console.error("[mcp] bindKey failed", err));
          return ok(`created expense ${id}`, { status: "created", recordId: id, preview });
        } catch (err) {
          await reservation?.release().catch(() => {});
          throw err;
        }
      }),
  );

  server.registerTool(
    "add_settlement",
    {
      title: "Add settlement",
      description:
        "Record that one member paid another back (from must differ from to), for example 'I paid Hua back 3,000'. Not for shared costs: use add_expense. Call with dryRun: true first and confirm with the user. from defaults to the user. amount accepts the same forms as add_expense ('1,200', '150+200'); currency defaults to the group's. People are given as memberId (preferred) or an exact name; on a miss or tie nothing is written and you get the candidates, so ask the user.",
      inputSchema: {
        groupId: idSchema,
        from: memberRef.optional().describe("Who paid; default me."),
        to: memberRef.describe("Who received the money."),
        amount: z.union([z.number().positive().max(10_000_000), z.string().min(1).max(60)]),
        currency: z.enum(SUPPORTED_CURRENCIES).optional(),
        settledAt: daySchema
          .optional()
          .describe("YYYY-MM-DD, default today in the group's time zone."),
        idempotencyKey: keySchema,
        dryRun: z.boolean().optional().describe("Preview only: nothing is written."),
      },
      annotations: WRITE,
    },
    (args) =>
      guarded(async () => {
        const { group, members, labels } = await openGroup(auth, args.groupId, "write", {
          countAs: args.dryRun ? "read" : "write",
        });
        const find = makeResolver(members, auth.user.id);
        const parsed = parseMcpAmount(args.amount);
        if (!parsed.ok) throw new ToolError("bad_request", parsed.message);
        const currency = resolveCurrency(args.currency, parsed.currency, group.defaultCurrency);
        const fromId = args.from !== undefined ? find(args.from).id : auth.user.id;
        const toId = find(args.to).id;
        if (fromId === toId) throw new ToolError("bad_request", "from and to must differ");

        if (args.dryRun) {
          const label = (id: number) => labels.get(id) ?? "?";
          return ok("dry run: nothing written", {
            status: "dry_run",
            preview: {
              from: { memberId: fromId, label: label(fromId) },
              to: { memberId: toId, label: label(toId) },
              amount: parsed.amount,
              currency,
              settledAt: args.settledAt ?? todayIn(group.timezone),
            },
          });
        }

        const held = await reserve(auth, args.idempotencyKey);
        if (held.early) return held.early;
        const reservation = held.reservation;

        // Same schema as the REST route: the tool's own checks don't cover the amount range.
        const input = settlementInputSchema.safeParse({
          fromUserId: fromId,
          toUserId: toId,
          amount: parsed.amount,
          currency,
          settledAt: args.settledAt,
        });
        if (!input.success) {
          await reservation?.release().catch(() => {});
          throw new ToolError("bad_request", input.error.issues[0].message);
        }

        try {
          const { id } = await createSettlement(args.groupId, input.data, {
            actor: mcpActor(auth),
          });
          await reservation?.bind(id).catch((err) => console.error("[mcp] bindKey failed", err));
          return ok(`created settlement ${id}`, {
            status: "created",
            recordId: id,
            settlement: { fromMemberId: fromId, toMemberId: toId, amount: parsed.amount, currency },
          });
        } catch (err) {
          await reservation?.release().catch(() => {});
          throw err;
        }
      }),
  );
}
