# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Maintenance rule:** When implementing a feature that changes architecture, env vars, DB schema, or testing conventions, update this file in the same PR/commit. Also check whether the public help site (`src/app/help/**`, see "Help site" below) needs updating — it describes user-visible behaviour, so a changed bot reply, button label, form field, or permission goes stale there silently if not updated in the same commit.

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

A single Next.js 15 (App Router) app serves five concerns simultaneously:

1. **Telegram Bot** — grammY webhook at `POST /api/telegram`
2. **Mini App frontend** — React pages at `/mini/**` (Telegram-embedded, `initData` auth)
3. **Web App frontend** — React pages at `/app/**` (standalone browser, Auth.js session-cookie auth) + `/login`
4. **REST API** — Next.js route handlers at `/api/**` (shared by both frontends)
5. **Help site** — public MDX pages at `/help/**` (no auth)

The Mini App and Web App share the same **lower-level building blocks** — `src/components/**`, `src/lib/**`, and the `/api/**` route handlers — and differ only in how auth/context is supplied (see API Auth and Web Auth below). **They do NOT share the top-level page components**, though: each route under `/mini/**` has a hand-maintained near-duplicate under `/app/**` (e.g. `src/app/mini/groups/[id]/page.tsx` vs `src/app/app/groups/[id]/page.tsx`), differing only in fetcher (`tmaFetch` vs `webFetch`), link prefixes (`/mini` vs `/app`), and a few imports. **When you change list/detail UI or page behaviour, apply the same change to both copies.** Shared, testable logic should live in `src/lib/**` and be imported by both (see `src/lib/expense-view.ts`).

### What to share, and what to leave duplicated

**The test is not "is this written twice" — it is "when the copies drift, does anything fail loudly?"** Duplication that breaks a build or a test can wait; duplication that quietly produces a wrong result is what earns a shared module. Everything currently shared was collapsed for that reason, and each case names its own silent failure:

- **Both ends of a wire contract belong in the same file.** `src/lib/deep-link.ts` builds *and* parses the `startapp` payload. When it was six builders and one parser, a mismatch didn't throw — the deep link just landed on the group list and nobody noticed for weeks. Anything with a producer and a consumer that must agree (a URL payload, a `callback_data` shape, a stored format) goes in one module, round-trip tested against itself rather than against hand-written strings.
- **A query shape whose omission degrades output instead of erroring.** `USER_COLUMNS` (`src/bot/profiles.ts`) exists because a select that forgets `telegramId` still succeeds — it just renders every mention as plain text.
- **One thing rendered by two renderers.** An expense card and a settlement notice draw the same 🔗 App 編輯 / 🗑 刪除 buttons, so `BTN` (`src/lib/buttons.ts`) owns the wording. Prose that *names* a button interpolates the same constant, so `/help` can't start describing a button that was renamed.

**Leave it duplicated when sharing would cost more than the drift.** Three standing examples:

- The `/mini` and `/app` page pairs are deliberately hand-maintained copies (see above) — they diverge on purpose and a shared abstraction would fight both.
- A callback toast with a **single** caller stays inline next to the condition it describes. `TOAST` in `src/lib/buttons.ts` only holds the ones with two or more callers; a message you have to open another file to read is worse than a repeated one.
- Not every repeated block is the same idea. Two functions that happen to look alike today, for unrelated reasons, will need to diverge tomorrow — and un-sharing is harder than sharing.

**Where it goes:** `src/lib/**` when the bot *and* the API or a frontend both need it (that also keeps it pure and unit-testable — see `src/lib/expense-view.ts`, `src/lib/record-notice.ts`); `src/bot/**` when only the bot does. `src/lib` may import a leaf module from `src/bot` (`notify.ts` renders the expense card), but keep those leaves dependency-free so it never becomes a cycle.

**Still duplicated, and known:** the `Number.isFinite` id-parsing preamble repeated in ~15 `/api/**` route handlers. Worth collapsing; just hasn't been.

### Bot (`src/bot/`)

`src/bot/index.ts` exports a lazy singleton `getBot()` — the bot instance is not created until the first webhook hit, so `TELEGRAM_BOT_TOKEN` doesn't need to exist at build time. Middleware runs in registration order: `chatMigration` → `registerUser` → `trackMembership` → commands.

Two middleware layers auto-populate the DB:
- `registerUser` — upserts the `users` row for any message sender
- `trackMembership` — upserts the `group_members` row

#### Membership tracking is event-sourced, and cannot be backfilled

The Bot API has **no "list chat members" endpoint** (only `getChatMemberCount`, `getChatAdministrators`, and `getChatMember` for an id you already have), so `group_members` is assembled from whatever events happen to arrive. Four sources, in the order a person is most likely to hit them:

1. `registerUser` — the sender of any group message or callback query the bot actually receives, which under **privacy mode** (BotFather's default) is only slash commands, @mentions of the bot, and replies to the bot's own messages. So this is "anyone who has used the bot", *not* "anyone who has talked in the group" — turning privacy mode off widens it to every message at the cost of the bot reading all group chat. Explicitly **not** `chat_member` updates: there `ctx.from` is whoever caused a status change, so seating them would add a lurker the moment they leave, or an admin for kicking someone. A spurious `group_members` row silently enlarges every equal split.
2. `trackMembership` on `new_chat_members` — the service message for someone added after the bot joined.
3. `trackMembership` on `chat_member` — every member status change, including invite-link joins; registers the *target*, and only on an absent → present transition. **Not delivered by default**: requires `chat_member` in `setWebhook`'s `allowed_updates` (`scripts/set-webhook.ts`) *and* the bot being a group administrator.
4. `/join` (`src/bot/commands/join.ts`) and `forwardJoin` — manual, for people none of the above caught. **`/join` means "reply to their message, then type `/join`"** — that is the only form the help text, the usage message and the command menu mention. One person per reply, and privacy mode means it must be the `/join` command carrying the reply; a bare reply to another user never reaches the bot.

Two limits worth knowing before trying to "just add everyone":

- **Group creation emits no roster.** MTProto's `messageActionChatCreate` carries the initial participant list, but the Bot API flattens it to `Message.group_chat_created = true` and drops the users. Adding the bot while creating the group registers only the creator.
- **Mentioning can't identify anyone who has a username.** The two mention entity kinds are not equivalent: `text_mention` carries the full `User` object, while `mention` is the bare text `@handle` and there is no username → id lookup. Which one you get is not your choice — Telegram rewrites an @-list pick into a plain `@username` for any account that has one, leaving `text_mention` for the handle-less few. `src/lib/parseMentions.ts` splits them; `/join` still accepts `text_mention` because it costs nothing, but **does not advertise it**, since instructing users to "pick from the @ list" mostly sends them down a path that silently produces the unusable kind.

**`/join` deliberately does not resolve a typed-out `@handle` at all.** The only available guess is a match against `users.username`, which is neither unique nor live — it refreshes only when its owner next touches the bot — so a handle that has changed hands quietly seats the wrong person, and `getChatMember` can't catch it because the stale account is usually still in the chat. `parseMentions` still returns the handles, but purely so `/join` can tell the sender they did nothing and point at the reply form. Everything `/join` *does* resolve goes through `getChatMember` before being seated, so it can't put a non-member into balances.

`/add` is a separate case and still accepts `@handle` (`src/lib/parseAdd.ts` → `resolveParticipants` in `src/bot/commands/add.ts`): its lookup is scoped to the group's **existing members** rather than all users, and a miss is a visible error rather than a silent wrong-person insert.

**Anything that seats someone in `group_members` from message content goes through `verifyInChat` (`src/bot/membership.ts`) first** — that's `/join`, and `/add`'s `text_mention` auto-registration. A `text_mention` entity survives copy/paste and forwarding, so it can name a person who was never in the chat, and only `getChatMember` can tell. Presence is three-valued: a transient API failure is indistinguishable from "never a member", so `unknown` does **not** seat.

**`getChatMember` is only trustworthy about other people when the bot is an administrator.** The Bot API guarantees it "for other users if the bot is an administrator in the chat"; a non-admin bot doesn't fail loudly, it can answer `left` for someone who really is a member — a confident wrong answer the call site can't detect. Since admin rights are optional for this bot (see `docs/DEPLOYMENT.md`), **any code that would refuse an action on a negative result must gate on `canVerifyMembership` first**. Both callers do, and both resolve the same way when the answer is untrustworthy: seat the person and rely on the user's intent. `/join`'s sender deliberately replied to someone and typed the command, and `/add`'s job is to record the expense — either signal beats an answer known to be unreliable. The spurious-member risk this guards against needs a copy-pasted or forwarded `text_mention`, which is far rarer than a group that never promoted the bot.

The reply form is the escape hatch from both limits, and its guards live in `replyTargetUser` (`src/lib/parseMentions.ts`): messages posted on behalf of a chat (anonymous admin, channel) have no personal account behind them and resolve to nothing, while a reply to a forwarded message resolves to the member who posted it here, not the original author.

`src/bot/handlers/chatMigration.ts` follows the chat-id rewrite when a basic group is upgraded to a supergroup (`migrate_to_chat_id` / `migrate_from_chat_id`), repointing `groups.telegramChatId` so the existing members and expenses aren't orphaned under the dead id. It **must stay registered before `registerUser`**, which would otherwise upsert an empty duplicate group row under the new id first. When a duplicate does exist, whichever side has no expenses is folded into the other (`absorbGroup` carries over members and rates rather than letting the cascade drop them); if both hold expenses it logs and bails, since merging two real ledgers can't be done safely without a human.

#### `/add` and the expense card

**The text grammar is one line and that's on purpose: `/add <金額> [幣別] [說明] [@人 …]`.** Anything that would need memorising — who splits, per-person shares, changing the currency — is a *button* on the expense card, not syntax. Don't grow the grammar; add a button.

- `src/lib/parseAdd.ts` — pure, unit-tested. Its job is **forgiveness**, not expressiveness: full-width characters, thousands separators (`1,200`), currency decorations (`$300`, `300元`, `€50`), `k`/`千`/`萬` multipliers and arithmetic (`150+200`, `(300+150)/3`) all parse. The arithmetic evaluator is a hand-written recursive-descent parser — **never `eval`**. Currency codes match `SUPPORTED_CURRENCIES` from `src/lib/zod.ts` and **nothing wider** — the bot must not create a record the Mini App form can't render or save (its `currency` is a `z.enum` over that same constant), and an unknown code makes `getRate` throw, which takes `/balance` and `/settle` down for the whole group. Amounts must end on whitespace, so `3杯咖啡` is rejected rather than read as 3. Error strings are plain text (no HTML) so the bot can echo user input without escaping.
- `src/bot/expenseCard.ts` — renders the card (text + keyboard) for any `CardMode` (`default` / `adjust` / `who` / `shares` / `currency`) and owns split writing. `writeSplits` stores `share_type='equal'` when every weight is 1 and `share_type='shares'` + `split_value` otherwise, so the Mini App form round-trips the same input.
- `src/bot/commands/expensePanel.ts` — the ⚙️ 調整 callbacks. **The panel keeps no state of its own** — every tap re-reads the expense from the DB and re-renders, so old cards keep working and concurrent taps converge. **Every callback that names an expense id must check it belongs to `ctx.dbGroup`** (`guard()`, plus `del_exp`, `upload_receipt` and the ForceReply replies): callback data is just a string the client sends, so an id on its own would reach across groups. That check is the bot-side counterpart of the REST layer's `assertGroupMember` — it is *not* an ownership check, see below. `editMessageText` is `.catch()`-ed because re-selecting the current value renders identical output, which Telegram rejects.
- **`selective` targets nobody on a prompt that replies to the bot's own message** (Telegram only targets @mentioned users and the sender of the replied-to message), so every prompt raised from a callback mentions the requester in its text instead of setting `reply_to_message_id`.
- 👥 誰分 / ⚖️ 份數 recompute every share from weights, so they are only offered when `panelEditable` — i.e. every split is `equal` or `shares`. A Mini-App `exact`/`percent`/`adjustment` split carries per-person intent the panel can't express, so the buttons are hidden and ✏️ 金額 rescales those amounts proportionally rather than flattening them.
- `src/bot/commands/add.ts` — the command, expense creation (`handleAddParsed`, also used by the photo-caption path in `receiptUpload.ts`) and the ForceReply replies. Parse failures reply *with* a ForceReply prompt so a mistake is one tap from a retry.

#### Who may edit or delete a record

**Group membership is the only gate — there is no per-record owner lock, and adding one back is a decision to re-open, not a cleanup.** Any member can edit or delete any expense or settlement in a group they belong to; `assertGroupMember` is the whole check.

The case that decides it is "A recorded 800 as 300 and B is standing right there": with an owner lock B can only ask A to fix it, and A may be asleep, driving, or already out of the group. [Splitwise has taken the same position for over a decade](https://kb.splitwise.com/groups/can-i-prevent-group-members-from-changing-expenses-or-set-permissions) — *anyone involved should be able to correct mistakes and fix errors* — against steady requests for permissions.

What replaces the lock is **attribution**:
- `expenses.createdBy` is returned by the expense and settlement endpoints — **including the `[expenseId]` / `[settlementId]` detail ones, which is where the edit forms actually read it from** — and the shared `ExpenseForm` / `SettlementForm` render 由 X 記錄 next to the destructive actions. `Initial.createdBy` is deliberately required rather than optional: it shipped optional once and the whole feature silently rendered nothing because only the list endpoints had been updated.
- Deleting someone else's record names them in the confirm dialog; the bot's 🗑 刪除 leaves a message saying what went, who recorded it and who removed it, so the chat itself is the audit trail.

- **Every change is logged** (`record_audit_log`), which is what makes "anyone may edit" answerable after the fact rather than just permissive. See "Audit log" below.

A **group-level** role (Settle Up's read-only vs edit) is the sane way to add restriction later if it's ever wanted — permission belonging to a person's standing in the group, not to who typed a given row. Don't reintroduce `createdBy` gating for it.

`group_members.status` (`active` / `inactive`) is unrelated: that controls *who is counted in a split*, not who may change records.

**404 on delete is now an ordinary outcome**, not an anomaly — two people can have the same record open. `deleteErrorMessage` (`src/lib/api-error.ts`) maps a status to a message and must never tell the user to retry something that cannot succeed.

#### Shared bot pieces

The inventory for the bot side of "What to share, and what to leave duplicated" above — each of these was collapsed because its duplicate failed silently, not loudly:

- `src/lib/deep-link.ts` — the `startapp` payload, **built and parsed here**.
  `groupLink` / `expenseLink` / `settlementLink` produce `group_<chatId>`,
  `…_exp_<id>` and `…_stl_<id>`; `parseStartParam` reads them back in
  `src/lib/auth/index.ts`. A builder that drifts from the parser doesn't throw —
  the link just lands on the group list and nobody notices. Round-trip tested.
- `src/lib/buttons.ts` — `BTN` (every inline-keyboard label) and `TOAST` (only
  the callback answers with more than one caller). Prose that *names* a button
  interpolates `BTN` too, so `/help` can't start describing a button that was
  renamed. Single-caller toasts stay inline next to their condition.
- `src/bot/profiles.ts` — `USER_COLUMNS` (the select shape every bot query
  needs, so one can't forget `telegramId` and silently degrade its mentions to
  plain text) and `loadMentionMap`, shared by `/balance` and `/settle`.
- `src/bot/awaiting.ts` — the 24 h expiry shared by `add_awaiting` and
  `receipt_awaiting`.

### Mini App (`src/app/mini/`)

Telegram Mini App accessed via the bot's `web_app` button. All pages are client components that call the REST API using `tmaFetch` (`src/lib/tma-fetch.ts`), which attaches `Authorization: tma <initData>`. Data fetching uses SWR (`src/components/mini/SWRProvider.tsx`).

**Before changing any Mini App UI, read [`docs/design-system.md`](docs/design-system.md).** It defines the design tokens and patterns — most importantly: radius has only two tiers (`rounded-2xl` containers / `rounded-lg` controls, both driven by `--radius`; never `rounded-xl` or arbitrary `rounded-[Npx]`), colors must go through the shadcn CSS vars (Telegram themes override them at runtime), financial figures use the `.num` utility, section headers use `.sect`, and loading states use the page-shaped skeletons in `components/mini/skeletons.tsx` (not spinners).

### Help site (`src/app/help/`)

Public Traditional-Chinese documentation, rendered from `.mdx` page files via
`@next/mdx` (`pageExtensions` + `withMDX` in `next.config.mjs`; `remark-gfm` for
tables, `rehype-slug` for heading anchors). Every MDX element is mapped to a
design-system-styled React component in the **root-level** `mdx-components.tsx`
— which is why `tailwind.config.ts`'s `content` array must list
`./mdx-components.tsx` explicitly, or Tailwind purges every class the docs rely
on and the pages ship unstyled in production.

`src/app/help/layout.tsx` holds the section list. **Adding a page means adding
both `src/app/help/<slug>/page.mdx` and an entry in that `sections` array** —
the array drives the sidebar, so a page without one is unreachable.

Entry points into the site are deliberately spread across every surface, since
documentation nobody can find is worthless: the bot's `/help` reply and both
`/start` welcomes carry a URL button, and 個人設定 → 關於 has a 使用說明 row in
the Mini App and Web App. All of them resolve the URL through
`src/lib/help-url.ts`, which derives it from `NEXT_PUBLIC_MINI_APP_URL`'s origin
rather than adding a second env var the two could disagree about. The Mini App
row calls `WebApp.openLink` instead of using an `<a>`, because navigating the
Mini App's own webview to `/help` would replace the app and strip its back button.

**The docs describe user-visible behaviour, so they go stale silently.** When a
change alters bot copy, a button label, a form field, or who is allowed to do
something, update `src/app/help/**` in the same commit.

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
`users` → `groups` → `group_members` (join) → `expenses` → `expense_payers` + `expense_splits` + `expense_receipts` → `exchange_rates` + `group_exchange_rates` + `auth_identities` + `sessions` + `receipt_awaiting` + `add_awaiting` + `group_delete_requests` + `record_audit_log` + `user_beancount_configs` (per-user, per-group beancount account customisation; `UNIQUE(user_id, group_id)`, jsonb `person_accounts`).

**Multi-payer model**: An expense has one or more payers in `expense_payers` (who paid, how much each) and one or more debtors in `expense_splits` (who owes, how much each). Both tables reference `expenses.id` with `ON DELETE CASCADE`. `expense_payers` has a `UNIQUE(expense_id, payer_id)` constraint. Both sides must sum to `expenses.amount`.

**Settlements are expenses**: A repayment ("A 還 B $X") is just a degenerate expense — A is the sole payer, B the sole debtor — with identical balance impact. It is stored in `expenses` with `type='settlement'` (vs `type='expense'`), one `expense_payers` row (= sender) and one `expense_splits` row (= receiver, `share_type='exact'`). There is **no** separate `settlements` table. The `type` column is the only discriminator: balance/FX/rate-lock treat both kinds the same (no branching), while the expense list/detail and stats filter `type='expense'` and the merged group list renders `type='settlement'` rows as `from → to`. The `/api/groups/[id]/settlements` routes still exist as a from/to-shaped façade over `type='settlement'` expenses (forms unchanged); only the list page was removed (settlements now appear inline in the main list).

`expenses.notice_message_id` holds the `message_id` of that record's message in the group chat — the expense card for an expense, the notice for a settlement (see Group notifications below). `NULL` for records predating the feature or when the send failed.

`receipt_awaiting` stores in-flight "waiting for receipt photo" state for the ForceReply bot flow (only triggered after text-only `/add`; not shown when photo is already attached via caption). `add_awaiting` stores in-flight ForceReply prompts: with `expense_id`/`field` NULL it's a bare `/add` waiting for expense text, otherwise the reply sets one field (`amount` / `currency`) of an existing expense and `panel_message_id` says which card to refresh.

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

Upload flow (bot): photo sent as a caption `/add …` stores `file_id` directly — the caption path goes through the same `handleAddParsed` as a text `/add`, so mentions and the ⚙️ 調整 panel work identically (only multi-photo albums are refused). The "🧾 收據" inline button on the card triggers a ForceReply prompt; the reply photo is matched via `receipt_awaiting`.

### Group messages for records (`src/lib/notify.ts` + `src/lib/record-notice.ts`)

Every record — **expense and settlement alike** — owns exactly **one** message in the Telegram group chat for its whole life, tracked by `expenses.notice_message_id`:

- **created** → send it, remember the `message_id`
- **edited** → `editMessageText` that same message in place (never a second message)
- **deleted** → the message is **kept** and edited into the `🗑 已刪除 …` line, with its inline keyboard dropped

This is what connects the two front ends to the chat: editing an expense in the Mini App refreshes the **same card** `/add` posted, and deleting it from either side leaves the same tombstone.

**There is exactly one renderer per message, and that matters more than it looks.** An expense renders as the expense card (`renderCard`, `src/bot/expenseCard.ts`) — the same text and buttons `/add` posts. A second, simpler renderer for "the notification" would silently downgrade a card into a plain line (losing ⚙️ 調整, the `≈` conversion line and the `×n` weights) the first time someone edited from the app. So `renderCard` takes a `CardOrigin` (`{ botUsername, chatId }`) rather than a `BotContext`, which is what lets an API route handler render the identical card without an update to hang off. `src/lib/record-notice.ts` holds only what the card doesn't cover: `formatSettlementNotice` (settlements have no card) and `formatDeletedNotice` (shared by both kinds); both are pure and unit-tested.

`/add` binds its own card with `rememberNoticeMessage` right after `ctx.reply`, so a bot-created expense never gets a duplicate — and since `receiptUpload.ts`'s photo-caption path delegates to `handleAddParsed`, that one call site covers every bot-created expense. Everything created from the Mini App / Web App is sent by the API route handler.

`src/lib/notify.ts` does the delivery: `loadNoticeRecord` / `sendRecordNotice` / `updateRecordNotice` / `markNoticeDeleted`, all of which swallow their errors — a kicked bot or a manually deleted message must never fail the API request. An edit falls back to posting a fresh message (and re-remembering it) when there is nothing editable; Telegram's `message is not modified` rejection is treated as success, not a reason to re-post. An edited card re-renders in `default` mode, so a card left open on the ⚙️ panel collapses back to the summary — the panel mode is UI state, not part of the record.

Three things to keep in mind when touching this:

- **Deletes must snapshot first.** Call `loadNoticeRecord` *before* deleting the row — the record, its creator and its `notice_message_id` are gone afterwards. Both the bot's `del_exp` callback and the API's `DELETE` do this.
- **The tombstone's attribution is load-bearing.** `formatDeletedNotice` names what went, who recorded it and who removed it. That is what stands in for the per-record owner lock this app deliberately doesn't have (see "Who may edit or delete a record") — don't quietly reduce it to "已刪除".
- **Silence is inherited.** Messages are silent because the bot's api middleware (`src/bot/index.ts`) stamps `disable_notification: true` on every `send*` call. Nothing in `notify.ts` sets it explicitly, so removing that middleware would un-silence every one of them.

Deep links: the card's 🔗 App 編輯 uses `?startapp=group_<chatId>_exp_<id>`, a settlement notice `_stl_<id>` — both parsed in `src/lib/auth/index.ts`, surfaced as `activeExpenseId` / `activeSettlementId` by `/api/me/groups`, and redirected in `src/app/mini/page.tsx`. The 🗑 刪除 button on both is the same `del_exp:<id>` callback, group-scoped and (per the policy above) not owner-gated.

### Audit log (`src/lib/record-mutation.ts` + `record-audit.ts` + `record-history.ts`)

Every create, edit and delete of a record is logged to `record_audit_log` with
who did it, from which surface, and a full before/after snapshot. This is the
accounting half of "any member may edit anything" — without it, relaxing the
owner lock would mean changes are both unrestricted *and* untraceable.

**Audit and the group message are one layer, on purpose. Do not split them.**
`logCreated` / `logUpdated` / `logDeleted` write the log *and* drive
`src/lib/notify.ts`. The fifteen mutation sites are spread across six route
handlers and seven bot callbacks; a standalone `logAudit()` next to each would
eventually be forgotten somewhere, and a missing audit row is invisible.
Fusing it to the one thing those sites already cannot skip — keeping the
Telegram message in sync — means forgetting shows up the same day, as a message
that stops matching the record. `actor` is a required argument for the same
reason: the compiler asks "who did this?" at every call site.

Passing `api: null` says the caller owns the group message and will render it
itself (the bot's panel buttons, which re-render the card in a mode this layer
must not flatten; and `/add`, which posts the card it just built). **The log is
written either way** — there is no call shape that logs nothing.

Other things to know:

- **`record_id` has no foreign key, deliberately.** `ON DELETE CASCADE` would
  erase "who deleted this" at the exact moment that row becomes the only
  evidence. `group_id` *does* cascade — deleting the group should take its log.
- **`src/bot/expenseEdits.ts` exists because of an import cycle.** `notify.ts`
  imports `expenseCard.ts` to render a card from a route handler, so that module
  has to stay a dependency-free leaf. Every bot write to an existing expense
  therefore lives in `expenseEdits.ts`, which may import `record-mutation.ts`.
- **A rate lock is logged once for the group, not once per rewritten record**
  (`recordType: 'group'`, `record_id: NULL`) — fanning fifty rows out would bury
  the day's real edits. The affected ids ride in the JSONB payload so a single
  record's history can still explain why its converted amount moved;
  `loadRecordHistory` matches them with a `@>` containment check.
- **An empty diff writes no row.** The expense PATCH replaces payers and splits
  wholesale on every save, so `diffRecords` (pure, unit-tested) decides whether
  anything a reader cares about actually moved.
- Snapshots reuse `NoticeRecord` plus a few columns, so the log can't drift into
  describing records differently from the chat message. Names are captured as
  they were then — that is the point of a log.
- Retention is unbounded. At this app's scale that's fine; if it ever isn't, null
  out `before`/`after` on old rows rather than deleting them, since the row
  itself is the evidence.

Surfaces: both record forms show 由 X 於 T 記錄 and, once edited, a tappable
最後由 Y 於 T 修改; `/{mini,app}/groups/[id]/activity` is the group feed, and the
same page with `?record=<id>` is one record's history.

### Beancount 匯出 (`src/lib/beancount.ts`)

A single record (expense or settlement) can be copied as a beancount transaction via the **`Bean` icon button** in the top-right of the expense/settlement edit form header (`CopyBeancountButton`, edit mode only). The output is from the **personal-ledger perspective** of the current user (U):
- `Expenses:Uncategorized` — U's own share (the schema has no category, so the default is a fixed account; the user re-categorises after pasting).
- `Assets:Cash` — cash U fronted (negative).
- `Assets:Receivable:<X>` — net position with each other person X (positive = X owes U, negative = U owes X). U's net is allocated proportionally across the opposite-sign counterparties, so multi-payer records stay balanced and only reflect U's own legs. Settlements skip the Expenses leg and just move cash ↔ receivable.

The three account prefixes above are the **defaults** (`DEFAULT_BEANCOUNT_ACCOUNTS`). The feature is **opt-in per (user, group)**: a user enables it on its own standalone settings page (`/{mini,app}/groups/[id]/settings/beancount`, reached via a nav row from the group settings page — not an inline section there anymore, issue #59), which writes a `user_beancount_configs` row (`expenses_account`, `cash_account`, `receivable_prefix`, and a jsonb `person_accounts` map of memberUserId→account leaf). **No row = feature off**, so `CopyBeancountButton` (which SWR-fetches `GET /api/groups/[id]/beancount`) renders nothing and the button stays hidden. The config is personal — it only affects the setter, not other members of the same group. CRUD is `GET/PUT/DELETE /api/groups/[id]/beancount`, keyed on `(auth.user.id, groupId)`; account strings are zod-validated against `BEANCOUNT_ACCOUNT_RE` / `BEANCOUNT_LEAF_RE`.

The settings page itself (`BeancountSettingsSection`, shared by `/mini` + `/app`) follows an Apple Wi-Fi-style pattern rather than a plain form: a description + `Switch` toggle is always shown, and the account fields (`帳戶設定`) plus the per-member account list (`成員帳戶`) only render once the toggle is on — flipping it on does an immediate `PUT` with the defaults, flipping it off opens a `ConfirmDialog` first (it's a full `DELETE`, so any customisation is lost, unlike Apple's own toggle-is-immediate behaviour). Saving shows a transient "已儲存" flag next to the button (there's no separate read-only/edit split to collapse back into, since the fields are always live); a save or the disable request disables every input for its duration.

`recordToBeancount` in `src/lib/beancount.ts` is **pure** (no DB/fetch) and unit-tested in `src/lib/__tests__/beancount.test.ts`; it takes the resolved `accounts` (defaulting to `DEFAULT_BEANCOUNT_ACCOUNTS`) so tests and any caller can pass custom prefixes. Postings carry a `kind` tag (`expenses`/`cash`/`receivable`) so the rounding-residual fold targets a receivable leg regardless of the configured prefix. FX is resolved by the caller (`CopyBeancountButton`) following the same pin→group→market priority as `src/lib/fx.ts` — using the per-record pin when present, else `GET /api/groups/[id]/rates/effective` — and passed in as `fx`; the function appends `@ <rate> <quote>` to every posting so the transaction balances in both the record currency and the group default. The button lives in the **shared** `ExpenseForm`/`SettlementForm`, so it appears in both `/mini` and `/app` from one place.

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

### Git conventions

Commit subjects and PR titles follow **Conventional Commits**: `type(scope): imperative description`, lowercase after the colon, no trailing period, subject ≤72 chars.

- Types in use: `feat`, `fix`, `chore`, `ci`, `docs`, `refactor`.
- Scope is optional and names an area rather than a file — `bot`, `mini`, `deps`.
- The body carries the *why*. Explanations that a user can't act on belong here, not in the bot's replies (see `src/bot/commands/help.ts`).

The prefix is for humans only: the release workflow's semver bump is a manual `workflow_dispatch` input (`.github/workflows/merge-dev-to-main.yml`), **not** parsed from commit types, so a wrong prefix can't mis-release anything.

### Deployment

Production runs on **Vercel** (frontend + bot webhook + API in one deploy), served from a **custom domain** (not the default `*.vercel.app`), backed by **Neon Postgres**, with the Mini App registered in **BotFather**. The repo is `chiachunho/splitbill-telegram-bot` (private); `origin` is HTTPS. The **default branch is `dev`** — open all PRs against `dev`, not `main`. Pushing to the default branch triggers Vercel auto-deploy. Full step-by-step in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Things that bite, in priority order:
- `TELEGRAM_WEBHOOK_SECRET` must be **identical** in Vercel and in local `.env.local` — `/api/telegram` rejects mismatched `X-Telegram-Bot-Api-Secret-Token` headers.
- `NEXT_PUBLIC_MINI_APP_URL` is baked at **build time**; changing it requires a redeploy.
- The Telegram webhook only needs re-setting (`pnpm bot:set-webhook https://<domain>`) when the **domain, the secret, or the `allowed_updates` list changes** — not on every deploy. `allowed_updates` lives on Telegram's side, not in the deploy, so editing the array in `scripts/set-webhook.ts` does nothing until the script is re-run; the update types it drops just silently stop arriving.
- `chat_member` additionally requires the bot to be a **group administrator**. Without that it's simply never delivered — membership tracking quietly falls back to the narrower `new_chat_members` and invite-link joins go unrecorded.
- Both `NEXT_PUBLIC_MINI_APP_URL` (private-chat button) and the BotFather-registered Web App URL (group direct-link) must point at the production `/mini`.
- Schema reaches Neon via `pnpm db:push` (run from a machine whose `DATABASE_URL` points at the prod DB); there is no migration step in CI.
- **When a schema change requires a data migration**, run `pnpm tsx scripts/<migration>.ts` BEFORE `pnpm db:push`. The scripts are idempotent and abort loudly if prerequisites are missing. Running `db:push` first drops source columns and makes the migration impossible without a restore.
- `TELEGRAM_STORAGE_CHAT_ID` must be set before deploying the receipt-photo feature. Create a private channel, add the bot as admin, get the `chat_id` (a large negative number), and add it to Vercel env vars + local `.env.local`.

### Testing

Vitest with `vite-tsconfig-paths`. Tests live in `src/lib/__tests__/` and `src/lib/auth/__tests__/`. Only pure lib functions are unit-tested; API routes and bot commands are not. The vitest config injects dummy env vars so modules that import `@/db` don't throw during test collection.
