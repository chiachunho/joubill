# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
pnpm bot:set-webhook  # tsx scripts/set-webhook.ts
```

Package manager is **pnpm**. Do not use npm or yarn.

## Architecture

A single Next.js 15 (App Router) app serves three concerns simultaneously:

1. **Telegram Bot** — grammY webhook at `POST /api/telegram`
2. **Mini App frontend** — React pages at `/mini/**`
3. **Mini App REST API** — Next.js route handlers at `/api/groups/[id]/**`

### Bot (`src/bot/`)

`src/bot/index.ts` exports a lazy singleton `getBot()` — the bot instance is not created until the first webhook hit, so `BOT_TOKEN` doesn't need to exist at build time. Middleware runs in registration order: `registerUser` → `trackMembership` → commands.

Two middleware layers auto-populate the DB:
- `registerUser` — upserts the `users` row for any message sender
- `trackMembership` — upserts the `group_members` row

### Mini App (`src/app/mini/`)

Telegram Mini App accessed via the bot's `web_app` button. All pages are client components that call the REST API using `tmaFetch` (`src/lib/tma-fetch.ts`), which attaches `Authorization: tma <initData>`. Data fetching uses SWR (`src/components/mini/SWRProvider.tsx`).

**Before changing any Mini App UI, read [`docs/design-system.md`](docs/design-system.md).** It defines the design tokens and patterns — most importantly: radius has only two tiers (`rounded-2xl` containers / `rounded-lg` controls, both driven by `--radius`; never `rounded-xl` or arbitrary `rounded-[Npx]`), colors must go through the shadcn CSS vars (Telegram themes override them at runtime), financial figures use the `.num` utility, section headers use `.sect`, and loading states use the page-shaped skeletons in `components/mini/skeletons.tsx` (not spinners).

### API Auth (`src/lib/auth/`)

Every API route handler wraps with `withAuth` (`src/lib/auth/route.ts`), which calls `getAuth(req)` to:
1. Parse the `Authorization: tma <raw>` header
2. HMAC-verify the Telegram `initData` string (`src/lib/auth/initData.ts`)
3. Upsert the user row and resolve `start_param` → group

Group membership is enforced separately via `assertGroupMember`.

### Database (`src/db/`)

Drizzle ORM + Neon Serverless Postgres. Six tables defined in `src/db/schema.ts`:
`users` → `groups` → `group_members` (join) → `expenses` → `expense_splits` → `settlements` + `exchange_rates`.

Schema is pushed directly with `db:push` (no migration workflow). `numeric` columns come back as strings from Drizzle; use `n()` from `src/lib/money.ts` to parse them to numbers.

### Settlement logic

Split across two files deliberately:
- `src/lib/settlement-core.ts` — pure greedy min-transfer algorithm, no DB, fully testable
- `src/lib/settlement.ts` — DB queries that build `NetBalance[]`, then delegates to core

### FX (`src/lib/fx.ts`)

Exchange rates are cached per `(base, quote, date)` in the `exchange_rates` table. Historical expenses always use the rate as of `spent_at`, so balances don't silently shift when rates move.

### Environment variables

Validated at runtime (not build time) via `serverEnv()` in `src/lib/env.ts`:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_MINI_APP_NAME` — short name from BotFather `/newapp`
- `DATABASE_URL` — Neon pooled connection string
- `NEXT_PUBLIC_MINI_APP_URL` — public URL of the `/mini` route

All route handlers must set `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"` because they use the Neon serverless driver.

### Testing

Vitest with `vite-tsconfig-paths`. Tests live in `src/lib/__tests__/` and `src/lib/auth/__tests__/`. Only pure lib functions are unit-tested; API routes and bot commands are not. The vitest config injects dummy env vars so modules that import `@/db` don't throw during test collection.
