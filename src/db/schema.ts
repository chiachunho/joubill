import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  index,
  integer,
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
export const groups = pgTable("groups", {
  id: serial("id").primaryKey(),
  telegramChatId: bigint("telegram_chat_id", { mode: "number" }).notNull().unique(),
  title: text("title").notNull(),
  defaultCurrency: varchar("default_currency", { length: 3 }).notNull().default("TWD"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    description: text("description"),
    spentAt: timestamp("spent_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    receiptFileId: text("receipt_file_id"),
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

/** Confirmed settlement transfers. Written after /settle suggestions are acted on. */
export const settlements = pgTable(
  "settlements",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    fromUserId: integer("from_user_id")
      .notNull()
      .references(() => users.id),
    toUserId: integer("to_user_id")
      .notNull()
      .references(() => users.id),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("settlements_group_idx").on(t.groupId, t.settledAt)],
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
 * Tracks in-flight "waiting for /add details" states in group chats.
 * Created when a user sends /add with no arguments; deleted once the user
 * replies with expense text (or the row expires after 24 h).
 */
export const addAwaiting = pgTable("add_awaiting", {
  id: serial("id").primaryKey(),
  chatId: bigint("chat_id", { mode: "number" }).notNull(),
  messageId: integer("message_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** FX rate cache. One row per (base, quote, as_of_date); fetched once per day. */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    base: varchar("base", { length: 3 }).notNull(),
    quote: varchar("quote", { length: 3 }).notNull(),
    rate: numeric("rate", { precision: 20, scale: 10 }).notNull(),
    asOfDate: date("as_of_date").notNull().default(sql`CURRENT_DATE`),
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
export type Settlement = typeof settlements.$inferSelect;
export type NewSettlement = typeof settlements.$inferInsert;
export type ExchangeRate = typeof exchangeRates.$inferSelect;
export type AuthIdentity = typeof authIdentities.$inferSelect;
export type NewAuthIdentity = typeof authIdentities.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type ReceiptAwaiting = typeof receiptAwaiting.$inferSelect;
export type AddAwaiting = typeof addAwaiting.$inferSelect;
export type ExpenseReceipt = typeof expenseReceipts.$inferSelect;
