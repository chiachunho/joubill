import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

/** Internal user. telegramId is nullable so non-Telegram OAuth providers (Phase 4) can create users too. */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  // Telegram user IDs are still within 2^53; switch to bigint mode if they ever grow past that.
  // Nullable: future OAuth-only users (GitHub/Google) won't have a Telegram ID.
  telegramId: bigint("telegram_id", { mode: "number" }).unique(),
  username: text("username"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  languageCode: text("language_code"),
  email: text("email"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A Telegram chat (group / supergroup) maps to one splitbill group. */
export const groups = pgTable(
  "groups",
  {
    id: serial("id").primaryKey(),
    // The chat this group lives in: ('telegram', '<chat id>'). Both NULL for a group with no chat.
    // Read and query through src/lib/chat.ts — never touch these two columns directly.
    chatType: varchar("chat_type", { length: 16 }),
    chatId: text("chat_id"),
    title: text("title").notNull(),
    defaultCurrency: varchar("default_currency", { length: 3 }).notNull().default("TWD"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("groups_chat").on(t.chatType, t.chatId),
    check("groups_chat_pair", sql`(${t.chatType} IS NULL) = (${t.chatId} IS NULL)`),
  ],
);

/** Group membership. Auto-populated when the bot sees a user speak or get mentioned. */
export const groupMembers = pgTable(
  "group_members",
  {
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

/** A single expense: total amount, currency. Payers live in expense_payers; split details in expense_splits. */
export const expenses = pgTable(
  "expenses",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /** 'expense' = a real group cost; 'settlement' = a repayment transfer modelled
     *  as a single-payer (from) / single-debtor (to) expense. The two share the
     *  same balance/FX machinery; only listing and stats filter on this. */
    type: varchar("type", { length: 16 }).notNull().default("expense"),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    description: text("description"),
    spentAt: timestamp("spent_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    receiptFileId: text("receipt_file_id"),
    /** Optional pinned FX rate: 1 unit of `currency` = fxRate units of `fxQuote`.
     *  Set when the user enters a custom rate for this expense (e.g. the card's
     *  actual rate). Applied only while the group default currency === fxQuote;
     *  takes precedence over group custom rates and the market rate cache. */
    fxRate: numeric("fx_rate", { precision: 20, scale: 10 }),
    fxQuote: varchar("fx_quote", { length: 3 }),
    /** message_id of this record's notification message in the group chat.
     *  One message per record for its whole life: created → sent, edited →
     *  that same message is edited, deleted → edited to a struck-through
     *  "已刪除" version (the message is deliberately kept). NULL for records
     *  predating the feature, or when the send failed. See src/lib/notify.ts. */
    noticeMessageId: integer("notice_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("expenses_group_spent_idx").on(t.groupId, t.spentAt)],
);

/** Per-payer contribution for an expense. Supports splitting payment across multiple people. */
export const expensePayers = pgTable(
  "expense_payers",
  {
    id: serial("id").primaryKey(),
    expenseId: integer("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    payerId: integer("payer_id")
      .notNull()
      .references(() => users.id),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  },
  (t) => [
    index("expense_payers_expense_idx").on(t.expenseId),
    index("expense_payers_payer_idx").on(t.payerId),
    unique("expense_payers_expense_payer_unique").on(t.expenseId, t.payerId),
  ],
);

/** Per-debtor split of an expense. share_type: equal | exact | percent | shares | adjustment. */
export const expenseSplits = pgTable(
  "expense_splits",
  {
    id: serial("id").primaryKey(),
    expenseId: integer("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    debtorId: integer("debtor_id")
      .notNull()
      .references(() => users.id),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    shareType: varchar("share_type", { length: 16 }).notNull().default("equal"),
    /** Raw input value from the form: percentage for percent, share count for shares,
     *  adjustment delta for adjustment. NULL for equal/exact (amount is the raw value). */
    splitValue: numeric("split_value", { precision: 14, scale: 6 }),
  },
  (t) => [
    index("expense_splits_expense_idx").on(t.expenseId),
    index("expense_splits_debtor_idx").on(t.debtorId),
  ],
);

/** Up to 5 receipt photos per expense. Position determines display order. */
export const expenseReceipts = pgTable(
  "expense_receipts",
  {
    id: serial("id").primaryKey(),
    expenseId: integer("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    fileId: text("file_id").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("expense_receipts_expense_idx").on(t.expenseId)],
);

/**
 * Tracks in-flight "waiting for receipt photo" states in group chats.
 * Created when a user clicks the "Upload Receipt" button after a text /add;
 * deleted once the user replies with a photo (or the row expires after 24 h).
 */
export const receiptAwaiting = pgTable("receipt_awaiting", {
  id: serial("id").primaryKey(),
  chatId: bigint("chat_id", { mode: "number" }).notNull(),
  messageId: integer("message_id").notNull(),
  expenseId: integer("expense_id")
    .notNull()
    .references(() => expenses.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Tracks in-flight ForceReply prompts in group chats: either "waiting for /add
 * details" (bare /add) or "waiting for a new value" for one field of an
 * existing expense (the ✏️ 金額 / 💱 其他幣別 buttons on the expense card).
 * Deleted once the user replies (or the row expires after 24 h).
 */
export const addAwaiting = pgTable("add_awaiting", {
  id: serial("id").primaryKey(),
  chatId: bigint("chat_id", { mode: "number" }).notNull(),
  /** Message id of the ForceReply prompt the user is expected to reply to. */
  messageId: integer("message_id").notNull(),
  /** NULL for a fresh /add; set when the reply edits an existing expense. */
  expenseId: integer("expense_id").references(() => expenses.id, { onDelete: "cascade" }),
  /** Which field the reply fills in: 'amount' | 'currency'. NULL for a fresh /add. */
  field: varchar("field", { length: 16 }),
  /** Message id of the expense card to refresh after the reply. */
  panelMessageId: integer("panel_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Group-level custom FX rates: 1 `base` = `rate` × `quote`, agreed by the group.
 * Overrides the market rate cache for ALL of the group's expenses in that
 * currency (past and future) — a deliberate departure from the historical-rate
 * principle, since trips usually settle on one fixed rate. Per-expense pinned
 * rates (expenses.fx_rate) still win over these.
 */
export const groupExchangeRates = pgTable(
  "group_exchange_rates",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    base: varchar("base", { length: 3 }).notNull(),
    quote: varchar("quote", { length: 3 }).notNull(),
    rate: numeric("rate", { precision: 20, scale: 10 }).notNull(),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("group_exchange_rates_group_pair").on(t.groupId, t.base, t.quote)],
);

/** FX rate cache. One row per (base, quote, as_of_date); fetched once per day. */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    base: varchar("base", { length: 3 }).notNull(),
    quote: varchar("quote", { length: 3 }).notNull(),
    rate: numeric("rate", { precision: 20, scale: 10 }).notNull(),
    asOfDate: date("as_of_date")
      .notNull()
      .default(sql`CURRENT_DATE`),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.base, t.quote, t.asOfDate] })],
);

/**
 * One row per (provider, providerUid) pair. Maps to Auth.js `accounts` shape for
 * zero-friction integration when we add GitHub/Google in Phase 4.
 * provider: 'telegram' | 'github' | 'google'
 */
export const authIdentities = pgTable(
  "auth_identities",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUid: text("provider_uid").notNull(),
    email: text("email"),
    // OAuth token fields — null for Telegram identities, populated by Auth.js for GitHub/Google
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    expiresAt: integer("expires_at"), // Unix timestamp (seconds), per OAuth convention
    tokenType: text("token_type"),
    scope: text("scope"),
    idToken: text("id_token"),
  },
  (t) => [unique("auth_identities_provider_uid").on(t.provider, t.providerUid)],
);

/** DB-backed sessions for web login (cookie token → row). */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/**
 * Pending group deletion request. Required when group has >1 member — a second member
 * must approve before the group is deleted. One row per group (enforced by unique on groupId).
 */
export const groupDeleteRequests = pgTable("group_delete_requests", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id")
    .notNull()
    .unique()
    .references(() => groups.id, { onDelete: "cascade" }),
  requestedBy: integer("requested_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  telegramMessageId: integer("telegram_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Who changed which record, when, and what it looked like before and after.
 *
 * This is the accounting that replaces the per-record owner lock: any group
 * member may edit any record (see CLAUDE.md, "Who may edit or delete a
 * record"), so a change has to be attributable after the fact.
 *
 * **`recordId` deliberately has no foreign key.** `ON DELETE CASCADE` would
 * erase "who deleted this expense" at the exact moment that row becomes the
 * only evidence, and even `SET NULL` would orphan the record's own history. The
 * `before`/`after` snapshots stand alone, so a deleted record keeps a readable
 * past. `groupId` *does* cascade — deleting the group is meant to take its log
 * with it.
 *
 * `recordId` is NULL for group-level events (`rate_locked`), which are logged
 * once rather than once per touched row. Those still have to be findable from a
 * single record's history, so the affected ids live in `after` — see
 * `src/lib/record-audit.ts`.
 */
export const recordAuditLog = pgTable(
  "record_audit_log",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /** The `expenses.id` this is about; NULL for group-level events. No FK — see above. */
    recordId: integer("record_id"),
    /** 'expense' | 'settlement' | 'group' */
    recordType: varchar("record_type", { length: 16 }).notNull(),
    /** 'created' | 'updated' | 'deleted' | 'rate_locked' */
    action: varchar("action", { length: 24 }).notNull(),
    actorId: integer("actor_id")
      .notNull()
      .references(() => users.id),
    /** Which surface the change came from: 'bot' | 'app'. */
    source: varchar("source", { length: 8 }).notNull(),
    /** RecordSnapshot; NULL on 'created'. */
    before: jsonb("before"),
    /** RecordSnapshot, or the rate-lock payload; NULL on 'deleted'. */
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("record_audit_group_idx").on(t.groupId, t.createdAt),
    index("record_audit_record_idx").on(t.recordId),
  ],
);

/**
 * Per-(user, group) beancount account customisation for the "copy record"
 * feature. A row exists only when the user has enabled the feature for that
 * group; no row = feature off (the copy button stays hidden). `personAccounts`
 * maps a member's user id (as a string key) to the account leaf to use under
 * `receivablePrefix`; members absent from the map fall back to an auto-derived
 * name.
 */
export const userBeancountConfigs = pgTable(
  "user_beancount_configs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    expensesAccount: text("expenses_account").notNull(),
    cashAccount: text("cash_account").notNull(),
    receivablePrefix: text("receivable_prefix").notNull(),
    personAccounts: jsonb("person_accounts")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("user_beancount_configs_user_group").on(t.userId, t.groupId)],
);

// Convenient row types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type GroupMember = typeof groupMembers.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
export type ExpensePayer = typeof expensePayers.$inferSelect;
export type NewExpensePayer = typeof expensePayers.$inferInsert;
export type ExpenseSplit = typeof expenseSplits.$inferSelect;
export type NewExpenseSplit = typeof expenseSplits.$inferInsert;
export type ExchangeRate = typeof exchangeRates.$inferSelect;
export type GroupExchangeRate = typeof groupExchangeRates.$inferSelect;
export type NewGroupExchangeRate = typeof groupExchangeRates.$inferInsert;
export type AuthIdentity = typeof authIdentities.$inferSelect;
export type NewAuthIdentity = typeof authIdentities.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type ReceiptAwaiting = typeof receiptAwaiting.$inferSelect;
export type AddAwaiting = typeof addAwaiting.$inferSelect;
export type ExpenseReceipt = typeof expenseReceipts.$inferSelect;
export type GroupDeleteRequest = typeof groupDeleteRequests.$inferSelect;
export type RecordAuditLog = typeof recordAuditLog.$inferSelect;
export type NewRecordAuditLog = typeof recordAuditLog.$inferInsert;
export type UserBeancountConfig = typeof userBeancountConfigs.$inferSelect;
export type NewUserBeancountConfig = typeof userBeancountConfigs.$inferInsert;

/**
 * Applied data migrations (scripts/migrate.ts creates it with the same shape).
 * Declared here only so `db:push` doesn't see an unknown table and drop it.
 */
export const schemaMigrations = pgTable("schema_migrations", {
  id: text("id").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});
