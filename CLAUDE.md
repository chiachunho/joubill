# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Maintenance rule:** When implementing a feature that changes architecture, env vars, DB schema, or testing conventions, update this file in the same PR/commit.

## Commands

```bash
pnpm dev            # Next.js dev server on http://localhost:3000
pnpm build          # Production build
pnpm typecheck      # tsc --noEmit
pnpm lint           # ESLint via next lint
pnpm format         # Prettier

pnpm test           # Run all tests once (vitest)
pnpm test:watch     # Vitest watch mode
# Run a single test file:
pnpm vitest run src/lib/__tests__/settlement.test.ts

pnpm db:push        # Sync Drizzle schema to Neon (no migration files)
pnpm db:generate    # Generate migration SQL (not normally needed)
pnpm db:studio      # Drizzle Studio GUI
pnpm bot:set-webhook    # tsx scripts/set-webhook.ts <https-domain>
pnpm bot:set-commands   # tsx scripts/set-commands.ts (register the bot's slash-command menu)

# One-time data migrations:
pnpm tsx scripts/migrate-payers.ts       # (run BEFORE db:push) populate expense_payers from expenses.payer_id
pnpm tsx scripts/migrate-settlements.ts  # (run BEFORE db:push) fold settlements into expenses(type='settlement'), then db:push drops the table
pnpm db:migrate-identities               # (run AFTER db:push) backfill auth_identities from users.telegramId
```

Package manager is **pnpm**. Do not use npm or yarn.

## Architecture

A single Next.js 15 (App Router) app serves four concerns simultaneously:

1. **Telegram Bot** — grammY webhook at `POST /api/telegram`
2. **Mini App frontend** — React pages at `/mini/**` (Telegram-embedded, `initData` auth)
3. **Web App frontend** — React pages at `/app/**` (standalone browser, Auth.js session-cookie auth) + `/login`
4. **REST API** — Next.js route handlers at `/api/**` (shared by both frontends)

The Mini App and Web App share the same **lower-level building blocks** — `src/components/**`, `src/lib/**`, and the `/api/**` route handlers — and differ only in how auth/context is supplied (see API Auth and Web Auth below). **They do NOT share the top-level page components**, though: each route under `/mini/**` has a hand-maintained near-duplicate under `/app/**` (e.g. `src/app/mini/groups/[id]/page.tsx` vs `src/app/app/groups/[id]/page.tsx`), differing only in fetcher (`tmaFetch` vs `webFetch`), link prefixes (`/mini` vs `/app`), and a few imports. **When you change list/detail UI or page behaviour, apply the same change to both copies.** Shared, testable logic should live in `src/lib/**` and be imported by both (see `src/lib/expense-view.ts`).

### Bot (`src/bot/`)

`src/bot/index.ts` exports a lazy singleton `getBot()` — the bot instance is not created until the first webhook hit, so `TELEGRAM_BOT_TOKEN` doesn't need to exist at build time. Middleware runs in registration order: `registerUser` → `trackMembership` → commands.

Two middleware layers auto-populate the DB:
- `registerUser` — upserts the `users` row for any message sender
- `trackMembership` — upserts the `group_members` row

### Mini App (`src/app/mini/`)

Telegram Mini App accessed via the bot's `web_app` button. All pages are client components that call the REST API using `tmaFetch` (`src/lib/tma-fetch.ts`), which attaches `Authorization: tma <initData>`. Data fetching uses SWR (`src/components/mini/SWRProvider.tsx`).

**Before changing any Mini App UI, read [`docs/design-system.md`](docs/design-system.md).** It defines the design tokens and patterns — most importantly: radius has only two tiers (`rounded-2xl` containers / `rounded-lg` controls, both driven by `--radius`; never `rounded-xl` or arbitrary `rounded-[Npx]`), colors must go through the shadcn CSS vars (Telegram themes override them at runtime), financial figures use the `.num` utility, section headers use `.sect`, and loading states use the page-shaped skeletons in `components/mini/skeletons.tsx` (not spinners).

### API Auth (`src/lib/auth/`)

Every API route handler wraps with `withAuth` (`src/lib/auth/route.ts`), which calls `getAuth(req)`. `getAuth` accepts **two** auth sources and returns the same `Auth { user, groupFromParam? }` shape regardless:

1. **Mini App** — `Authorization: tma <raw>` header → HMAC-verify the Telegram `initData` string (`src/lib/auth/initData.ts`) → upsert user + resolve `start_param` → group (`groupFromParam` set).
2. **Web App** — `session` cookie → look up a non-expired row in `sessions` → user (`groupFromParam` is `null`; the web frontend picks the group itself).

Group membership is enforced separately via `assertGroupMember`.

### Web Auth (`src/auth.ts`, `src/lib/auth/`)

Standalone web login runs on **Auth.js (NextAuth v5)** with a Drizzle adapter (`src/lib/auth/nextAuthAdapter.ts`). Providers: **Telegram** (custom OAuth2 + PKCE — see [`docs/telegram-oauth-spec.md`](docs/telegram-oauth-spec.md) for the protocol quirks), plus optional **GitHub** / **Google** (enabled only when their env vars are set). Handler routes live at `/api/auth/[...nextauth]` and `/api/auth/logout`.

Identity is **multi-provider**: one `users` row can have many `auth_identities` (`provider`, `providerUid`). Both the Mini App (`initData`) and Telegram web login key on the **numeric Telegram user id** (not the OIDC `sub`), so the same person resolves to one user across both paths. The bot's user-upsert path goes through `src/lib/auth/upsertTelegramUser.ts`.

Fetchers: Mini App pages use `tmaFetch` (`src/lib/tma-fetch.ts`, attaches the `tma` header); Web App pages use `src/lib/web-fetch.ts` (`credentials: "include"`, cookie-based).

### Database (`src/db/`)

Drizzle ORM + Neon Serverless Postgres. Tables defined in `src/db/schema.ts`:
`users` → `groups` → `group_members` (join) → `expenses` → `expense_payers` + `expense_splits` + `expense_receipts` → `exchange_rates` + `group_exchange_rates` + `auth_identities` + `sessions` + `receipt_awaiting` + `add_awaiting` + `group_delete_requests`.

**Multi-payer model**: An expense has one or more payers in `expense_payers` (who paid, how much each) and one or more debtors in `expense_splits` (who owes, how much each). Both tables reference `expenses.id` with `ON DELETE CASCADE`. `expense_payers` has a `UNIQUE(expense_id, payer_id)` constraint. Both sides must sum to `expenses.amount`.

**Settlements are expenses**: A repayment ("A 還 B $X") is just a degenerate expense — A is the sole payer, B the sole debtor — with identical balance impact. It is stored in `expenses` with `type='settlement'` (vs `type='expense'`), one `expense_payers` row (= sender) and one `expense_splits` row (= receiver, `share_type='exact'`). There is **no** separate `settlements` table. The `type` column is the only discriminator: balance/FX/rate-lock treat both kinds the same (no branching), while the expense list/detail and stats filter `type='expense'` and the merged group list renders `type='settlement'` rows as `from → to`. The `/api/groups/[id]/settlements` routes still exist as a from/to-shaped façade over `type='settlement'` expenses (forms unchanged); only the list page was removed (settlements now appear inline in the main list).

`receipt_awaiting` stores in-flight "waiting for receipt photo" state for the ForceReply bot flow (only triggered after text-only `/add`; not shown when photo is already attached via caption).

Schema is pushed directly with `db:push` (no migration workflow). `numeric` columns come back as strings from Drizzle; use `n()` from `src/lib/money.ts` to parse them to numbers.

**Schema upgrade procedure** (when adding tables or dropping columns): if the change requires a data migration, place a script in `scripts/` that reads the old data and writes the new shape, run it first, then run `pnpm db:push`. The script must abort loudly if the source column/table is already gone. See `scripts/migrate-payers.ts` as a reference.

### Settlement logic

Split across two files deliberately:
- `src/lib/settlement-core.ts` — pure greedy min-transfer algorithm, no DB, fully testable
- `src/lib/settlement.ts` — DB queries that build `NetBalance[]`, then delegates to core

`computeGroupBalances` joins through `expense_payers` (not `expenses`) to credit payers, and through `expense_splits` to debit debtors. Both sides are FX-normalised to the group's `defaultCurrency` using historical rates. Settlements need no special handling: stored as `type='settlement'` expenses, their sender/receiver flow through the same payer/split legs.

### FX (`src/lib/fx.ts`)

Rate resolution priority, highest first:

1. **Per-record pinned rate** — `fx_rate` + `fx_quote` on `expenses` (both `type='expense'` and `type='settlement'` rows; set via the form's 匯率 field when the record currency differs from the group default, or written by the rate-lock flow). Applies only while `fx_quote` matches the group's current default currency; goes dormant (falls through) if the default changes later — and PATCH preserves dormant pins so they revive if the default reverts. `fx_quote` is stamped server-side by `resolveRecordFx` / `fxColumnsFor`. All balance/stats conversions go through `resolveRate` in `src/lib/fx.ts`, the single place that encodes this priority order.
2. **Group custom rate** — `group_exchange_rates` rows (managed in group settings via `GET/PUT/DELETE /api/groups/[id]/rates`). One agreed rate per `(group, base, quote)` that applies to **all** of the group's expenses in that currency, past and future — a deliberate departure from the historical-rate principle. Inverse pairs are derived automatically (`buildOverrideMap`); upserting a pair replaces any explicit inverse row so the two directions can't drift apart. Loaded once per request with `loadGroupRateOverrides` and passed to `getRate` as the optional `overrides` map.
3. **Market rate** — cached per `(base, quote, date)` in the `exchange_rates` table (global, shared across groups; group overrides are never written into it). Historical expenses always use the rate as of `spent_at`, so balances don't silently shift when rates move.

`GET /api/groups/[id]/rates/effective?base=X` returns the effective rate (group override or market) and the market reference; with `&counts=1` it also returns `affectedExpenses`/`affectedSettlements` (existing records in `base` without an applicable pin, split by `type='expense'`/`'settlement'`). The forms use it without counts for the rate prefill; the settings page uses it with counts and blocks save/delete until they load.

When existing records would be re-converted, the settings page asks for the scope before saving or deleting. `PUT /api/groups/[id]/rates` with `lockExisting: true` (and `DELETE …?lock=1`) first pins every affected expense **and settlement** at its **current** effective rate (old group rate or per-day market rate, resolved by `planRateLock` in `src/lib/rate-lock.ts` before the write transaction; both kinds are `expenses` rows, told apart by `type`) so the change only applies to future records — this is how "each trip has its own agreed rate" is supported. Changing the group's default currency also pops a warning, since it re-converts everything at market rates and makes all custom rates/pins dormant.

### Receipt photos (`src/app/api/tg-photo/` and `src/app/api/tg-upload/`)

Receipts are stored on Telegram's servers — only the permanent `file_id` is persisted. An expense can have **up to 5 receipt photos**, stored as rows in `expense_receipts` (`position` sets display order). The legacy single-photo column `expenses.receipt_file_id` still exists and is written by the bot's `/add`; the expenses API merges it with `expense_receipts` rows. Serving goes through the `/api/tg-photo` proxy (accepts `?fileId=` or `?path=`) so the bot token never appears in client URLs.

Upload flow (Mini App): `POST /api/tg-upload` (auth-protected) → `sendPhoto` to the private storage channel → returns `file_id` → saved with the expense.

Upload flow (bot): photo sent as a caption `/add …` stores `file_id` directly. The "上傳收據" inline button after `/add` triggers a ForceReply prompt; the reply photo is matched via `receipt_awaiting`.

### Environment variables

Validated at runtime (not build time) via `serverEnv()` in `src/lib/env.ts`:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_MINI_APP_NAME` — short name from BotFather `/newapp`
- `TELEGRAM_STORAGE_CHAT_ID` — `chat_id` of the private Telegram channel used as photo storage (bot must be admin with "Post Messages" permission)
- `DATABASE_URL` — Neon pooled connection string
- `NEXT_PUBLIC_MINI_APP_URL` — public URL of the `/mini` route

The web-auth (Auth.js) vars are **not** in `serverEnv()` — Auth.js reads them directly from `process.env`:
- `AUTH_SECRET` — required; signs Auth.js sessions (`openssl rand -base64 32`)
- `AUTH_TELEGRAM_CLIENT_ID` / `AUTH_TELEGRAM_CLIENT_SECRET` — from BotFather → Bot Settings → Web Login
- `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`, `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — optional; each provider is enabled only when its pair is present

All route handlers must set `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"` because they use the Neon serverless driver.

### Deployment

Production runs on **Vercel** (frontend + bot webhook + API in one deploy), served from a **custom domain** (not the default `*.vercel.app`), backed by **Neon Postgres**, with the Mini App registered in **BotFather**. The repo is `chiachunho/splitbill-telegram-bot` (private); `origin` is HTTPS. The **default branch is `dev`** — open all PRs against `dev`, not `main`. Pushing to the default branch triggers Vercel auto-deploy. Full step-by-step in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Things that bite, in priority order:
- `TELEGRAM_WEBHOOK_SECRET` must be **identical** in Vercel and in local `.env.local` — `/api/telegram` rejects mismatched `X-Telegram-Bot-Api-Secret-Token` headers.
- `NEXT_PUBLIC_MINI_APP_URL` is baked at **build time**; changing it requires a redeploy.
- The Telegram webhook only needs re-setting (`pnpm bot:set-webhook https://<domain>`) when the **domain changes** — not on every deploy.
- Both `NEXT_PUBLIC_MINI_APP_URL` (private-chat button) and the BotFather-registered Web App URL (group direct-link) must point at the production `/mini`.
- Schema reaches Neon via `pnpm db:push` (run from a machine whose `DATABASE_URL` points at the prod DB); there is no migration step in CI.
- **When a schema change requires a data migration**, run `pnpm tsx scripts/<migration>.ts` BEFORE `pnpm db:push`. The scripts are idempotent and abort loudly if prerequisites are missing. Running `db:push` first drops source columns and makes the migration impossible without a restore.
- `TELEGRAM_STORAGE_CHAT_ID` must be set before deploying the receipt-photo feature. Create a private channel, add the bot as admin, get the `chat_id` (a large negative number), and add it to Vercel env vars + local `.env.local`.

### Testing

Vitest with `vite-tsconfig-paths`. Tests live in `src/lib/__tests__/` and `src/lib/auth/__tests__/`. Only pure lib functions are unit-tested; API routes and bot commands are not. The vitest config injects dummy env vars so modules that import `@/db` don't throw during test collection.
