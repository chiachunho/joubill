import { z } from "zod";

export const SUPPORTED_CURRENCIES = [
  "TWD",
  "USD",
  "JPY",
  "EUR",
  "CNY",
  "HKD",
  "GBP",
  "KRW",
  "SGD",
  "AUD",
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const splitItemSchema = z.object({
  debtorId: z.number().int().positive(),
  amount: z.number().nonnegative(),
});

/**
 * Body schema for POST /api/groups/[id]/expenses and PATCH /api/groups/[id]/expenses/[expenseId].
 *
 * Splits are always sent as final amounts in the same currency as the expense; for
 * percent-mode the client does the multiplication before posting. share_type is
 * stored as metadata only — the source of truth for balances is splits[].amount.
 */
export const expenseInputSchema = z
  .object({
    amount: z.number().positive().max(10_000_000),
    currency: z.enum(SUPPORTED_CURRENCIES),
    description: z.string().max(500).nullable(),
    payerId: z.number().int().positive(),
    spentAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
      message: "spentAt must be a valid date string",
    }),
    shareType: z.enum(["equal", "exact", "percent"]),
    splits: z.array(splitItemSchema).min(1),
  })
  .refine(
    (data) => {
      const sum = data.splits.reduce((s, x) => s + x.amount, 0);
      return Math.abs(sum - data.amount) < 0.02;
    },
    { message: "splits sum must equal amount (within ±0.01)" },
  );

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

/**
 * Body schema for POST /api/groups/[id]/settlements — records that a debtor
 * actually paid a creditor in some currency, on some date.
 */
export const settlementInputSchema = z.object({
  fromUserId: z.number().int().positive(),
  toUserId: z.number().int().positive(),
  amount: z.number().positive().max(10_000_000),
  currency: z.enum(SUPPORTED_CURRENCIES),
  settledAt: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), { message: "settledAt must be a valid date string" })
    .optional(),
});

export type SettlementInput = z.infer<typeof settlementInputSchema>;
