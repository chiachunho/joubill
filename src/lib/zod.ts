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
  splitValue: z.number().nullable().optional(),
});

const payerItemSchema = z.object({
  payerId: z.number().int().positive(),
  amount: z.number().positive(),
});

export const SHARE_TYPES = ["equal", "exact", "percent", "shares", "adjustment"] as const;

/**
 * Body schema for POST /api/groups/[id]/expenses and PATCH /api/groups/[id]/expenses/[expenseId].
 *
 * Splits are always sent as final amounts in the same currency as the expense; for
 * percent-mode the client does the multiplication before posting. share_type is
 * stored as metadata only — the source of truth for balances is splits[].amount.
 * Payers must also sum to the expense total.
 *
 * fxRate is an optional pinned rate (1 unit of `currency` in the group's default
 * currency); null/absent means "use the group custom rate or market rate".
 */
export const expenseInputSchema = z
  .object({
    amount: z.number().positive().max(10_000_000),
    currency: z.enum(SUPPORTED_CURRENCIES),
    fxRate: z.number().positive().max(1_000_000_000).nullable().optional(),
    description: z.string().max(500).nullable(),
    payers: z.array(payerItemSchema).min(1),
    spentAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
      message: "spentAt must be a valid date string",
    }),
    shareType: z.enum(SHARE_TYPES),
    splits: z.array(splitItemSchema).min(1),
    receiptFileIds: z.array(z.string().max(256)).max(5).optional(),
  })
  .refine(
    (data) => {
      const sum = data.splits.reduce((s, x) => s + x.amount, 0);
      return Math.abs(sum - data.amount) < 0.005;
    },
    { message: "splits sum must equal amount (within ±0.005)" },
  )
  .refine(
    (data) => {
      const sum = data.payers.reduce((s, x) => s + x.amount, 0);
      return Math.abs(sum - data.amount) < 0.005;
    },
    { message: "payers sum must equal amount (within ±0.005)" },
  )
  .refine(
    (data) => {
      const ids = data.payers.map((p) => p.payerId);
      return ids.length === new Set(ids).size;
    },
    { message: "duplicate payerId in payers array" },
  );

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

/**
 * Body schema for POST /api/groups/[id]/settlements — records that a debtor
 * actually paid a creditor in some currency, on some date.
 *
 * fxRate is an optional pinned rate (1 unit of `currency` in the group's
 * default currency), same semantics as on expenses.
 */
export const settlementInputSchema = z.object({
  fromUserId: z.number().int().positive(),
  toUserId: z.number().int().positive(),
  amount: z.number().positive().max(10_000_000),
  currency: z.enum(SUPPORTED_CURRENCIES),
  fxRate: z.number().positive().max(1_000_000_000).nullable().optional(),
  settledAt: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), {
      message: "settledAt must be a valid date string",
    })
    .optional(),
});

export type SettlementInput = z.infer<typeof settlementInputSchema>;

/**
 * Client-side form schema for the Mini App ExpenseForm (react-hook-form +
 * zodResolver). Fields are strings as typed into inputs; cross-field rules
 * (participant selection + split-sum balance per share type) live in the
 * superRefine so RHF surfaces them on the `participants` field.
 */
export const expenseFormSchema = z
  .object({
    amount: z
      .string()
      .refine((v) => Number.isFinite(parseFloat(v)) && parseFloat(v) > 0, "請輸入有效金額"),
    currency: z.enum(SUPPORTED_CURRENCIES),
    /** Custom FX rate as typed; empty string = use the automatic rate. */
    fxRate: z
      .string()
      .refine(
        (v) => v === "" || (Number.isFinite(parseFloat(v)) && parseFloat(v) > 0),
        "請輸入有效匯率",
      ),
    description: z.string().max(500),
    payers: z
      .array(
        z.object({
          userId: z.string().min(1),
          amount: z.string(),
        }),
      )
      .min(1),
    spentDate: z.date(),
    shareType: z.enum(SHARE_TYPES),
    participants: z.array(
      z.object({
        userId: z.number().int().positive(),
        included: z.boolean(),
        value: z.string(),
      }),
    ),
  })
  .superRefine((data, ctx) => {
    // Payers validation
    const total = parseFloat(data.amount) || 0;
    if (total > 0) {
      const emptyPayer = data.payers.some((p) => !p.userId);
      if (emptyPayer) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "請選擇付款人", path: ["payers"] });
      } else if (
        data.payers.length > 1 &&
        data.payers.some((p) => !Number.isFinite(parseFloat(p.amount)))
      ) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "請輸入有效金額", path: ["payers"] });
      } else {
        const payerSum = data.payers.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
        if (Math.abs(payerSum - total) >= 0.005) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "付款人金額加總需等於總金額",
            path: ["payers"],
          });
        }
      }
    }

    // Participants validation
    const included = data.participants.filter((p) => p.included);
    if (included.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "至少選一位參與者",
        path: ["participants"],
      });
      return;
    }
    if (data.shareType === "equal") return;

    const sum = included.reduce((s, p) => s + (parseFloat(p.value) || 0), 0);
    if (data.shareType === "percent") {
      if (Math.abs(sum - 100) >= 0.005) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "比例加總需為 100%",
          path: ["participants"],
        });
      }
    } else if (data.shareType === "shares") {
      if (sum <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "份數合計須大於 0",
          path: ["participants"],
        });
      }
    } else if (data.shareType === "adjustment") {
      if (sum > total) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "額外金額加總不能超過總金額",
          path: ["participants"],
        });
      }
    } else {
      if (Math.abs(sum - total) >= 0.005) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "分帳金額加總與總金額不符",
          path: ["participants"],
        });
      }
    }
  });

export type ExpenseFormValues = z.infer<typeof expenseFormSchema>;

/** Client-side form schema for the Mini App SettlementForm. */
export const settlementFormSchema = z
  .object({
    fromUserId: z.string().min(1),
    toUserId: z.string().min(1),
    amount: z
      .string()
      .refine((v) => Number.isFinite(parseFloat(v)) && parseFloat(v) > 0, "請輸入有效金額"),
    currency: z.enum(SUPPORTED_CURRENCIES),
    /** Custom FX rate as typed; empty string = use the automatic rate. */
    fxRate: z
      .string()
      .refine(
        (v) => v === "" || (Number.isFinite(parseFloat(v)) && parseFloat(v) > 0),
        "請輸入有效匯率",
      ),
    settledDate: z.date(),
  })
  .refine((d) => d.fromUserId !== d.toUserId, {
    message: "付款人與收款人不能相同",
    path: ["toUserId"],
  });

export type SettlementFormValues = z.infer<typeof settlementFormSchema>;

// ── Beancount account customisation (per-user, per-group) ────────────────────

/**
 * A full beancount account path, e.g. `Assets:Receivable` or `Expenses:Food:Dining`.
 * Beancount's own grammar only requires each segment to start with a letter or digit
 * (any Unicode letter, not just ASCII uppercase) — segments like `Assets:Flow:現金` are
 * valid beancount syntax and parse fine.
 */
export const BEANCOUNT_ACCOUNT_RE =
  /^(Assets|Liabilities|Equity|Income|Expenses)(:[\p{L}\p{N}][\p{L}\p{N}-]*)+$/u;
/** A single account leaf component (a person's name under the receivable prefix). */
export const BEANCOUNT_LEAF_RE = /^[\p{L}\p{N}][\p{L}\p{N}-]*$/u;

/** Shared with the settings-page inputs so the inline hint matches the API's rejection reason. */
export const BEANCOUNT_ACCOUNT_HINT =
  "每段路徑須以字母或數字開頭，例如 Assets:Cash 或 Assets:Flow:現金";
export const BEANCOUNT_LEAF_HINT = "須以字母或數字開頭，例如 Kevin 或 阿明";

const beancountAccount = z.string().trim().regex(BEANCOUNT_ACCOUNT_RE, BEANCOUNT_ACCOUNT_HINT);
const beancountLeaf = z.string().trim().regex(BEANCOUNT_LEAF_RE, BEANCOUNT_LEAF_HINT);

/** PUT body for a user's per-group beancount config. */
export const beancountConfigInputSchema = z.object({
  expensesAccount: beancountAccount,
  cashAccount: beancountAccount,
  receivablePrefix: beancountAccount,
  /** memberUserId (as string key) → account leaf. Blank/omitted leaves fall back to auto-derived. */
  personAccounts: z.record(z.string().regex(/^\d+$/), beancountLeaf).default({}),
});

export type BeancountConfigInput = z.infer<typeof beancountConfigInputSchema>;

/** POST /api/groups body: a group created on the web (no chat). */
export const groupCreateSchema = z.object({
  title: z.string().trim().min(1, "請輸入群組名稱").max(50, "群組名稱最多 50 字"),
  defaultCurrency: z.enum(SUPPORTED_CURRENCIES),
});

export type GroupCreateInput = z.infer<typeof groupCreateSchema>;
