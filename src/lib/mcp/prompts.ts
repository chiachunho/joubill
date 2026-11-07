import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * The 拆收據 working method as text. A pure function so the rules an agent follows
 * (one item at a time, running totals, exact split, remainder on the largest item) are
 * unit-tested rather than living only inside a registration call.
 */
export function splitReceiptText(opts: { groupId?: string; payer?: string }): string {
  const group = opts.groupId
    ? `The group is ${opts.groupId} (a groupId from list_groups).`
    : "Ask which group this belongs to; call list_groups and get_group.";
  const payer = opts.payer
    ? `${opts.payer} paid the whole bill.`
    : "Ask who paid unless the user already said (default: the user).";
  return [
    "Split the receipt the user attached, item by item, and record it as one expense.",
    group,
    payer,
    "",
    "Steps:",
    "1. Read the receipt: list every line item with its price, plus tax or service charge and the printed total. If the items do not add up to the total, say so and ask.",
    "2. Call get_group and use memberIds. Never guess who a name refers to.",
    "3. Go through the items one at a time. For each, ask who it belongs to (one person, several people sharing it, or everyone). After each answer show every person's running total and the amount still unassigned.",
    "4. Share tax and service charge in proportion to each person's items, unless the user says otherwise.",
    "5. Rounding: if the per-person amounts differ from the total by a few cents or yen, add the difference to the person with the largest amount and tell the user you did.",
    "6. Call add_expense with split.type 'exact' (an amount per person that sums to the total) and dryRun: true. Show the per-person amounts and wait for a clear yes.",
    "7. Call add_expense again without dryRun, using an idempotencyKey and the receipt image in images (also on the dryRun call, so a bad image is found early), so the expense and its photo are recorded together. Use attach_receipt only to add photos to an expense that already exists.",
    "If the user changes their mind about an item after step 6, start from the totals again; do not edit a recorded expense unless asked.",
  ].join("\n");
}

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "split_receipt",
    {
      title: "拆收據",
      description:
        "Walk through a receipt item by item, ask who each item belongs to, and record one expense split by exact amounts, with the photo attached.",
      argsSchema: {
        groupId: z.string().trim().max(20).optional().describe("The group to record in."),
        payer: z.string().trim().max(100).optional().describe("Who paid; default is you."),
      },
    },
    (args) => ({
      messages: [{ role: "user", content: { type: "text", text: splitReceiptText(args) } }],
    }),
  );
}
