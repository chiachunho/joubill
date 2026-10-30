# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Maintenance rule:** When implementing a feature that changes architecture, env vars, DB schema, or testing conventions, update this file in the same PR/commit. Also check whether the public help site (`src/app/help/**`, see "Help site" below) needs updating — it describes user-visible behaviour, so a changed bot reply, button label, form field, or permission goes stale there silently if not updated in the same commit.

## Commands

```bash
pnpm dev            # Next.js dev server on http://localhost:3000
pnpm build          # Production build
pnpm typecheck      # tsc --noEmit
pnpm lint           # ESLint via next lint
pnpm format         # Prettier (writes)
pnpm format:check   # Prettier (read-only; what PR check runs — keep the tree formatted)

pnpm test           # Run all tests once (vitest)
pnpm test:watch     # Vitest watch mode
pnpm e2e            # Playwright E2E against $E2E_BASE_URL (see Testing)
# Run a single test file:
pnpm vitest run src/lib/__tests__/settlement.test.ts

pnpm db:migrate     # Apply pending data migrations from migrations/ (recorded in schema_migrations)
pnpm db:push        # Sync Drizzle schema to Neon (no migration files)
pnpm db:generate    # Generate migration SQL (not normally needed)
pnpm db:studio      # Drizzle Studio GUI
pnpm bot:set-webhook    # tsx scripts/set-webhook.ts <https-domain>
pnpm bot:set-commands   # tsx scripts/set-commands.ts (register the bot's slash-command menu)
pnpm check:page-pairs   # warn when a diff edits one Mini App / Web App page copy and not the other (advisory; vs origin/dev by default)

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

The Mini App and Web App share the same **lower-level building blocks** — `src/components/**`, `src/lib/**`, and the `/api/**` route handlers — and differ only in how auth/context is supplied (see API Auth and Web Auth below). **The top-level page bodies are shared too**, in `src/components/pages/**`. Each route's `src/app/mini/**/page.tsx` and `src/app/app/**/page.tsx` is a thin wrapper that passes in a `Platform`. The type is `src/components/pages/platform.ts`; each app implements it in its own module (`platform.mini.tsx`, `platform.web.tsx`), and a wrapper imports only its own, so a route's bundle never carries the other app's fetchers or Telegram code. The `Platform` holds everything that legitimately differs between the apps: the base path for links, the authenticated raw request, the viewer's self-photo hook, and the platform's chrome (header leading control, back navigation, the group-list header, the help row, the sign-out section, and where an unauthenticated viewer is sent, which a body acts on through `useLoginRedirect`: a 401 sends the web to `/login?next=…` and shows the Mini App its error; what counts as a 401 and where it leads live once in `src/lib/auth-redirect.ts`, used by both `useLoginRedirect` and the Web App's store-wide 401 handler). Platform differences belong in that object, so a change to a shared body reaches both apps by construction. `pnpm check:page-pairs` flags a diff that touched one copy and not the other; the `page-pairs` job in `pr-check.yml` posts the same result as an advisory PR comment (it never fails the check, since some one-sided edits are intentional). The pairs are derived from the path, so a new page needs no entry anywhere. Shared, testable logic should live in `src/lib/**` and be imported by both (see `src/lib/expense-view.ts`).

### What to share, and what to leave duplicated

**The test is not "is this written twice" — it is "when the copies drift, does anything fail loudly?"** Duplication that breaks a build or a test can wait; duplication that quietly produces a wrong result is what earns a shared module. Everything currently shared was collapsed for that reason, and each case names its own silent failure:

- **Both ends of a wire contract belong in the same file.** `src/lib/deep-link.ts` builds _and_ parses the `startapp` payload. When it was six builders and one parser, a mismatch didn't throw — the deep link just landed on the group list and nobody noticed for weeks. Anything with a producer and a consumer that must agree (a URL payload, a `callback_data` shape, a stored format) goes in one module, round-trip tested against itself rather than against hand-written strings.
- **A query shape whose omission degrades output instead of erroring.** `USER_COLUMNS` (`src/bot/profiles.ts`) exists because a select that forgets `telegramId` still succeeds — it just renders every mention as plain text.
- **One thing rendered by two renderers.** An expense card and a settlement notice draw the same 🔗 App 編輯 / 🗑 刪除 buttons, so `BTN` (`src/lib/buttons.ts`) owns the wording. Prose that _names_ a button interpolates the same constant, so `/help` can't start describing a button that was renamed.

**Leave it duplicated when sharing would cost more than the drift.** Three standing examples:

- The per-app files that are not page wrappers: the two `layout.tsx` files and the seven `loading.tsx` skeletons. The layouts mount different providers (the Mini App loads the Telegram script and `TelegramApp`; the Web App mounts `AuthProvider mode="web"` with `WebStoreProvider`), so they cannot be one file. Each `loading.tsx` is a one-line render of a skeleton that already lives in `src/components/mini/skeletons.tsx`. The route-to-skeleton mapping is per-route content, and Next.js needs one `loading.tsx` per route segment, so sharing would remove no files. Drift there shows as a briefly wrong placeholder, not a wrong result. A change to one of these goes into both copies, and `pnpm check:page-pairs` warns when only one side changes.
- A callback toast with a **single** caller stays inline next to the condition it describes. `TOAST` in `src/lib/buttons.ts` only holds the ones with two or more callers; a message you have to open another file to read is worse than a repeated one.
- Not every repeated block is the same idea. Two functions that happen to look alike today, for unrelated reasons, will need to diverge tomorrow — and un-sharing is harder than sharing.

**Where it goes:** `src/lib/**` when the bot _and_ the API or a frontend both need it (that also keeps it pure and unit-testable — see `src/lib/expense-view.ts`, `src/lib/record-notice.ts`); `src/bot/**` when only the bot does. `src/lib` may import a leaf module from `src/bot` (`notify.ts` renders the expense card), but keep those leaves dependency-free so it never becomes a cycle.

**Still duplicated, and known:** the `Number.isFinite` id-parsing preamble repeated in ~15 `/api/**` route handlers. Worth collapsing; just hasn't been.

### Bot (`src/bot/`)

`src/bot/index.ts` exports a lazy singleton `getBot()` — the bot instance is not created until the first webhook hit, so `TELEGRAM_BOT_TOKEN` doesn't need to exist at build time. Middleware runs in registration order: `chatMigration` → `registerUser` → `trackMembership` → commands.

Two middleware layers auto-populate the DB:

- `registerUser` — upserts the `users` row for any message sender
- `trackMembership` — upserts the `group_members` row

#### Membership tracking is event-sourced, and cannot be backfilled

The Bot API has **no "list chat members" endpoint** (only `getChatMemberCount`, `getChatAdministrators`, and `getChatMember` for an id you already have), so `group_members` is assembled from whatever events happen to arrive. Four sources, in the order a person is most likely to hit them:

1. `registerUser` — the sender of any group message or callback query the bot actually receives, which under **privacy mode** (BotFather's default) is only slash commands, @mentions of the bot, and replies to the bot's own messages. So this is "anyone who has used the bot", _not_ "anyone who has talked in the group" — turning privacy mode off widens it to every message at the cost of the bot reading all group chat. Explicitly **not** `chat_member` updates: there `ctx.from` is whoever caused a status change, so seating them would add a lurker the moment they leave, or an admin for kicking someone. A spurious `group_members` row silently enlarges every equal split.
2. `trackMembership` on `new_chat_members` — the service message for someone added after the bot joined.
3. `trackMembership` on `chat_member` — every member status change, including invite-link joins; registers the _target_, and only on an absent → present transition. **Not delivered by default**: requires `chat_member` in `setWebhook`'s `allowed_updates` (`scripts/set-webhook.ts`) _and_ the bot being a group administrator.
4. `/join` (`src/bot/commands/join.ts`) and `forwardJoin` — manual, for people none of the above caught. **`/join` means "reply to their message, then type `/join`"** — that is the only form the help text, the usage message and the command menu mention. One person per reply, and privacy mode means it must be the `/join` command carrying the reply; a bare reply to another user never reaches the bot.

Two limits worth knowing before trying to "just add everyone":

- **Group creation emits no roster.** MTProto's `messageActionChatCreate` carries the initial participant list, but the Bot API flattens it to `Message.group_chat_created = true` and drops the users. Adding the bot while creating the group registers only the creator.
- **Mentioning can't identify anyone who has a username.** The two mention entity kinds are not equivalent: `text_mention` carries the full `User` object, while `mention` is the bare text `@handle` and there is no username → id lookup. Which one you get is not your choice — Telegram rewrites an @-list pick into a plain `@username` for any account that has one, leaving `text_mention` for the handle-less few. `src/lib/parseMentions.ts` splits them; `/join` still accepts `text_mention` because it costs nothing, but **does not advertise it**, since instructing users to "pick from the @ list" mostly sends them down a path that silently produces the unusable kind.

**`/join` deliberately does not resolve a typed-out `@handle` at all.** The only available guess is a match against `users.username`, which is neither unique nor live — it refreshes only when its owner next touches the bot — so a handle that has changed hands quietly seats the wrong person, and `getChatMember` can't catch it because the stale account is usually still in the chat. `parseMentions` still returns the handles, but purely so `/join` can tell the sender they did nothing and point at the reply form. Everything `/join` _does_ resolve goes through `getChatMember` before being seated, so it can't put a non-member into balances.

`/add` is a separate case and still accepts `@handle` (`src/lib/parseAdd.ts` → `resolveParticipants` in `src/bot/commands/add.ts`): its lookup is scoped to the group's **existing members** rather than all users, and a miss is a visible error rather than a silent wrong-person insert.

**Anything that seats someone in `group_members` from message content goes through `verifyInChat` (`src/bot/membership.ts`) first** — that's `/join`, and `/add`'s `text_mention` auto-registration. A `text_mention` entity survives copy/paste and forwarding, so it can name a person who was never in the chat, and only `getChatMember` can tell. Presence is three-valued: a transient API failure is indistinguishable from "never a member", so `unknown` does **not** seat.

**`getChatMember` is only trustworthy about other people when the bot is an administrator.** The Bot API guarantees it "for other users if the bot is an administrator in the chat"; a non-admin bot doesn't fail loudly, it can answer `left` for someone who really is a member — a confident wrong answer the call site can't detect. Since admin rights are optional for this bot (see `docs/DEPLOYMENT.md`), **any code that would refuse an action on a negative result must gate on `canVerifyMembership` first**. Both callers do, and both resolve the same way when the answer is untrustworthy: seat the person and rely on the user's intent. `/join`'s sender deliberately replied to someone and typed the command, and `/add`'s job is to record the expense — either signal beats an answer known to be unreliable. The spurious-member risk this guards against needs a copy-pasted or forwarded `text_mention`, which is far rarer than a group that never promoted the bot.

The reply form is the escape hatch from both limits, and its guards live in `replyTargetUser` (`src/lib/parseMentions.ts`): messages posted on behalf of a chat (anonymous admin, channel) have no personal account behind them and resolve to nothing, while a reply to a forwarded message resolves to the member who posted it here, not the original author.

`src/bot/handlers/chatMigration.ts` follows the chat-id rewrite when a basic group is upgraded to a supergroup (`migrate_to_chat_id` / `migrate_from_chat_id`), repointing `groups.(chat_type, chat_id)` so the existing members and expenses aren't orphaned under the dead id. It **must stay registered before `registerUser`**, which would otherwise upsert an empty duplicate group row under the new id first. When a duplicate does exist, whichever side has no expenses is folded into the other (`absorbGroup` carries over members and rates rather than letting the cascade drop them); if both hold expenses it logs and bails, since merging two real ledgers can't be done safely without a human.

#### `/add` and the expense card

**The text grammar is one line and that's on purpose: `/add <金額> [幣別] [說明] [@人 …]`.** Anything that would need memorising — who splits, per-person shares, changing the currency — is a _button_ on the expense card, not syntax. Don't grow the grammar; add a button.

- `src/lib/parseAdd.ts` — pure, unit-tested. Its job is **forgiveness**, not expressiveness: full-width characters, thousands separators (`1,200`), currency decorations (`$300`, `300元`, `€50`), `k`/`千`/`萬` multipliers and arithmetic (`150+200`, `(300+150)/3`) all parse. The arithmetic evaluator is a hand-written recursive-descent parser — **never `eval`**. Currency codes match `SUPPORTED_CURRENCIES` from `src/lib/zod.ts` and **nothing wider** — the bot must not create a record the Mini App form can't render or save (its `currency` is a `z.enum` over that same constant), and an unknown code makes `getRate` throw, which takes `/balance` and `/settle` down for the whole group. Amounts must end on whitespace, so `3杯咖啡` is rejected rather than read as 3. Error strings are plain text (no HTML) so the bot can echo user input without escaping.
- `src/bot/expenseCard.ts` — renders the card (text + keyboard) for any `CardMode` (`default` / `adjust` / `who` / `shares` / `currency`) and owns split writing. `writeSplits` stores `share_type='equal'` when every weight is 1 and `share_type='shares'` + `split_value` otherwise, so the Mini App form round-trips the same input.
- `src/bot/commands/expensePanel.ts` — the ⚙️ 調整 callbacks. **The panel keeps no state of its own** — every tap re-reads the expense from the DB and re-renders, so old cards keep working and concurrent taps converge. **Every callback that names an expense id must check it belongs to `ctx.dbGroup`** (`guard()`, plus `del_exp`, `upload_receipt` and the ForceReply replies): callback data is just a string the client sends, so an id on its own would reach across groups. That check is the bot-side counterpart of the REST layer's `assertGroupMember` — it is _not_ an ownership check, see below. `editMessageText` is `.catch()`-ed because re-selecting the current value renders identical output, which Telegram rejects.
- **`selective` targets nobody on a prompt that replies to the bot's own message** (Telegram only targets @mentioned users and the sender of the replied-to message), so every prompt raised from a callback mentions the requester in its text instead of setting `reply_to_message_id`.
- 👥 誰分 / ⚖️ 份數 recompute every share from weights, so they are only offered when `panelEditable` — i.e. every split is `equal` or `shares`.
- 💳 誰付 (`payer` mode, `exp:pay` / `exp:payt`) replaces the sole payer, so it is only offered when `payerEditable` — exactly one `expense_payers` row. Multi-payer expenses keep their per-person contributions and are edited in the App. A Mini-App `exact`/`percent`/`adjustment` split carries per-person intent the panel can't express, so the buttons are hidden and ✏️ 金額 rescales those amounts proportionally rather than flattening them.
- `src/bot/commands/add.ts` — the command, expense creation (`handleAddParsed`, also used by the photo-caption path in `receiptUpload.ts`) and the ForceReply replies. Parse failures reply _with_ a ForceReply prompt so a mistake is one tap from a retry.

#### Who may edit or delete a record

**Group membership is the only gate — there is no per-record owner lock, and adding one back is a decision to re-open, not a cleanup.** Any member can edit or delete any expense or settlement in a group they belong to; `assertGroupMember` is the whole check.

The case that decides it is "A recorded 800 as 300 and B is standing right there": with an owner lock B can only ask A to fix it, and A may be asleep, driving, or already out of the group. [Splitwise has taken the same position for over a decade](https://kb.splitwise.com/groups/can-i-prevent-group-members-from-changing-expenses-or-set-permissions) — _anyone involved should be able to correct mistakes and fix errors_ — against steady requests for permissions.

What replaces the lock is **attribution**:

- `expenses.createdBy` is returned by the expense and settlement endpoints — **including the `[expenseId]` / `[settlementId]` detail ones, which is where the edit forms actually read it from** — and the shared `ExpenseForm` / `SettlementForm` render 由 X 記錄 next to the destructive actions. `Initial.createdBy` is deliberately required rather than optional: it shipped optional once and the whole feature silently rendered nothing because only the list endpoints had been updated.
- Deleting someone else's record names them in the confirm dialog; the bot's 🗑 刪除 leaves a message saying what went, who recorded it and who removed it, so the chat itself is the audit trail.

- **Every change is logged** (`record_audit_log`), which is what makes "anyone may edit" answerable after the fact rather than just permissive. See "Audit log" below.

A **group-level** role (Settle Up's read-only vs edit) is the sane way to add restriction later if it's ever wanted — permission belonging to a person's standing in the group, not to who typed a given row. Don't reintroduce `createdBy` gating for it.

`group_members.status` (`active` / `inactive`) is unrelated: that controls _who is counted in a split_, not who may change records.

**404 on delete is now an ordinary outcome**, not an anomaly — two people can have the same record open. `deleteErrorMessage` (`src/lib/api-error.ts`) maps a status to a message and must never tell the user to retry something that cannot succeed.

#### Shared bot pieces

The inventory for the bot side of "What to share, and what to leave duplicated" above — each of these was collapsed because its duplicate failed silently, not loudly:

- `src/lib/deep-link.ts` — the `startapp` payload, **built and parsed here**.
  `groupLink` / `expenseLink` / `settlementLink` produce `group_<chatId>`,
  `…_exp_<id>` and `…_stl_<id>`; `parseStartParam` reads them back in
  `src/lib/auth/index.ts`. A builder that drifts from the parser doesn't throw —
  the link just lands on the group list and nobody notices. Round-trip tested.
- `src/lib/buttons.ts` — `BTN` (every inline-keyboard label) and `TOAST` (only
  the callback answers with more than one caller). Prose that _names_ a button
  interpolates `BTN` too, so `/help` can't start describing a button that was
  renamed. Single-caller toasts stay inline next to their condition.
- `src/bot/profiles.ts` — `USER_COLUMNS` (the select shape every bot query
  needs, so one can't forget `telegramId` and silently degrade its mentions to
  plain text) and `loadMentionMap`, shared by `/balance` and `/settle`.
- `src/bot/awaiting.ts` — the 24 h expiry shared by `add_awaiting` and
  `receipt_awaiting`.

### Mini App (`src/app/mini/`)

Telegram Mini App accessed via the bot's `web_app` button. All pages are client components that call the REST API through the RTK Query store (see "Client data layer" below), whose requests go through `tmaRawFetch` (`src/lib/tma-fetch.ts`), which attaches `Authorization: tma <initData>`.

**Before changing any Mini App UI, read [`docs/design-system.md`](docs/design-system.md).** It defines the design tokens and patterns — most importantly: radius has only two tiers (`rounded-2xl` containers / `rounded-lg` controls, both driven by `--radius`; never `rounded-xl` or arbitrary `rounded-[Npx]`), colors must go through the shadcn CSS vars (Telegram themes override them at runtime), financial figures use the `.num` utility, section headers use `.sect`, and loading states use the page-shaped skeletons in `components/mini/skeletons.tsx` (not spinners).

### Client data layer (`src/store/`)

All client reads and writes of `/api/**` go through **RTK Query** (`@reduxjs/toolkit` + `react-redux`); there is no other client-side store. `src/store/api.ts` is the one `createApi` for both apps, and **every endpoint is defined there** — a page never builds a URL or calls `fetch` for data the cache could hold.

- **Two stores, one api.** `makeStore(rawRequest, options)` (`src/store/store.ts`) is built per app: `StoreProvider` (`src/app/mini/`) with `tmaRawFetch`, `WebStoreProvider` (`src/app/app/`) with `webRawFetch` plus `onUnauthorized` (the 401 → `/login?next=…` redirect). The request reaches `apiBaseQuery` (`base-query.ts`) through the thunk `extra`, so the endpoint definitions are shared while a route's bundle carries only its own platform's fetcher. Don't import `tmaRawFetch` / `webRawFetch` from a shared component for data; the exception is what the cache has no use for (the receipt upload, the CSV download).
- **Errors** are `ApiError` (`src/lib/api-error.ts`): `{ status, data, message }`, where `message` is `${status} ${url}: ${body}` — the shape `isUnauthorizedError` has always read the status from, so a 401 is recognised whichever layer produced it. `status` is `0` when no response came. Use `apiErrorText` for the server's `{ error }` text, `apiErrorStatus` for a branch on status, `describeError` for the "無法載入" detail line; never `String(error)`, which prints `[object Object]`.
- **Cache invalidation is declared on the endpoint, not at the call site.** Tag types are listed at the top of `api.ts`; `ledgerTags(groupId)` is what any expense or settlement create/edit/delete touches (lists, balance, stats, activity) and `derivedFromRatesTags(groupId)` is what a rate or default-currency change touches (the same plus every record's detail, since converted amounts move). A new mutation names its tags there. Forms and pages must **not** keep their own list of keys to refresh: that list used to be copied into three components, and a key missing from one copy meant a page quietly showing numbers from before the edit. Group-scoped tags carry the group id as a _string_ (`String(groupId)`, since a page holds it as a string param and a form as a number); `Expense` / `Settlement` also use `<groupId>:<recordId>` for one record's detail.
- **A delete does not invalidate the record's own detail tag.** Its page is still mounted while the form navigates away, and refetching a record that no longer exists would flash a 404 on the way out.
- **Optimistic edits and cache writes** live in the second `injectEndpoints` block (so they can reach `baseApi.util` without the api naming its own type): the member status toggle and the default currency roll back on failure, and the beancount PUT/DELETE write their response straight into the cache so the settings page flips layout in the render the save finishes in.
- **Freshness** matches what the app had before RTK Query: `refetchOnMountOrArgChange: 5` shows the cached value and refetches behind it when it is more than 5 s old, and `keepUnusedDataFor: 300` keeps a left page's data for five minutes. `data` from a hook keeps the previous argument's result while a new one loads (the old `keepPreviousData`); use `currentData` when a decision must wait for the _current_ argument (`CustomRatesSection` does for the affected-record counts).
- **The activity feed and the expense list** are `infiniteQuery` endpoints (`getActivity`, `getExpenses`) with the previous page's `nextCursor` as the page param. Invalidating their tag refetches every loaded page, so an edit to a row on page 2 shows without the list resetting. See "Expense list pagination".
- Response types are shared in `src/lib/api-types.ts` (types only); pages used to each declare their own `MeResponse` / `MembersResponse` / `AvatarsResponse`, and the copies had drifted.
- **Testing**: `src/store/test-utils.tsx` has `fakeRequest(routes)` (a path → JSON map; an unlisted path answers 500 so a test can't pass on a request it never allowed; `Failure(status)` for errors) and `StoreWrapper`. Page tests render inside a `StoreWrapper` and `await` the data — it arrives asynchronously, unlike the old synchronous fallback. Cache behaviour (what a mutation refetches, rollbacks) is tested against the store directly in `src/store/__tests__/api.test.ts`.

### Help site (`src/app/help/`)

Public Traditional-Chinese documentation, rendered from `.mdx` page files via
`@next/mdx` (`pageExtensions` + `withMDX` in `next.config.mjs`; `remark-gfm` for
tables, `rehype-slug` for heading anchors). Every MDX element is mapped to a
design-system-styled React component in the **root-level** `mdx-components.tsx`
— which is why `tailwind.config.ts`'s `content` array must list
`./mdx-components.tsx` explicitly, or Tailwind purges every class the docs rely
on and the pages ship unstyled in production.

The remark/rehype plugins are passed to `createMDX` **by package name**
(`"remark-gfm"`, `"rehype-slug"`), not as imported functions: `pnpm dev`
(Turbopack) serialises the loader options and fails on a function. Keep
`@next/mdx` on the same major as `next` (both 15.x) — a mismatch fails Turbopack's
config validation.

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

Standalone web login runs on **Auth.js (NextAuth v5)** with a Drizzle adapter (`src/lib/auth/nextAuthAdapter.ts`). Providers: **Telegram** (custom OAuth2 + PKCE — see [`docs/telegram-oauth-spec.md`](docs/telegram-oauth-spec.md) for the protocol quirks), plus optional **GitHub** / **Google** / **LINE** (enabled only when their env vars are set; the flags live in `src/lib/auth/providers.ts`, which route handlers can import without pulling in NextAuth). Handler routes live at `/api/auth/[...nextauth]` and `/api/auth/logout`.

Identity is **multi-provider**: one `users` row can have many `auth_identities` (`provider`, `providerUid`). Both the Mini App (`initData`) and Telegram web login key on the **numeric Telegram user id** (not the OIDC `sub`), so the same person resolves to one user across both paths. The bot's user-upsert path goes through `src/lib/auth/upsertTelegramUser.ts`.

**Email auto-linking is on for GitHub and Google only, and deliberately off for LINE.** LINE's email is a separate permission the user may refuse and LINE does not promise it is verified, so matching on it would let anyone take over an account by registering its address. Telegram has no email at all, so a Telegram user who signs in with Google/LINE gets a **new, empty user** unless they link first. A person who already did that has two real accounts, which only an account merge (below) can join.

**Account linking (個人設定 → 登入方式, `LoginMethodsSection`)**: while signed in, `signIn(provider, { callbackUrl: "/app/settings" })` makes Auth.js bind the new account to the session's user (database sessions behave the same); if that identity already belongs to another user, the `signIn` callback turns it into a merge offer (see "Merging two accounts" below) instead of Auth.js's `OAuthAccountNotLinked`; signed out, that error still reaches `/login?error=` (`loginErrorMessage`). Two users are only ever merged by that explicit, confirmed flow. The action is `Platform.linkIdentity`: null in the Mini App, which only lists methods because OAuth can't run in Telegram's webview. Telegram is linkable from the web too (a Google-first account adding its Telegram): the adapter's `linkAccount` also sets `users.telegram_id`, which the bot and Mini App key on, inside the same transaction as the identity insert. It only succeeds when no other account owns that Telegram id; otherwise it becomes a merge offer, like any other identity that belongs to someone else. Telegram can't be unlinked. Avatars: `/api/me/profile` and the group avatars route use the bot's Telegram photo and fall back to `users.avatar_url` (the picture the login provider supplied); the `<img>`s set `referrerPolicy="no-referrer"` so provider-hosted pictures load. `GET /api/me/identities` and `DELETE /api/me/identities/[provider]` back the section; the DELETE is scoped to the caller and 409s on the last method (`canUnlink`, `src/lib/identities.ts`). The adapter's own `unlinkAccount` has no such guard, so never call it for this.

**Merging two accounts (`src/lib/account-merge.ts` + `account-merge-db.ts`, issue #99)**: the proof that one person owns both accounts is being signed in as A and then completing an OAuth sign-in that belongs to B, nothing less. The Auth.js `signIn` callback (`mergeRedirect`, `src/lib/auth/merge-ticket.ts`) sees the session cookie and an identity owned by another real user (an `auth_identities` row, or for Telegram also `users.telegram_id`), writes an `account_merge_tickets` row (10 minutes, single-use) and returns `/app/settings/merge`, so no session is created for B. The ticket id travels **only** in the httpOnly `merge_ticket` cookie scoped to `Path=/api/me/merge`, never in a URL. `GET /api/me/merge` is the preview, `POST` (`{ keepUserId, selfSettlements }`) claims the ticket with `UPDATE … WHERE consumed_at IS NULL RETURNING` in the same transaction as `mergeAccounts`, `DELETE` cancels; every missing, expired, used or someone else's ticket is the same 404 (`MERGE_TICKET_NOT_FOUND`). The page (`AccountMergePage`) is a pair like any other, but the merge itself is web-only because OAuth can't run in Telegram's webview: with `Platform.openInBrowser` set (the Mini App, entered from 登入方式 → 合併另一個帳號) it reads no ticket and only explains the steps, with a button that opens `/app/settings` in the browser. The web copy reloads with `location.assign` after a merge, because the current session may now belong to the other user; a 404 sends it back to 個人設定 with `?merge=expired`. The pure part refuses two different Telegram ids (`telegram_id` is unique) and two different uids of one provider (the settings page assumes one per provider), suggests keeping the Telegram holder, then the busier account, then the older one (`suggestKeep`), and plans memberships (one row, active if either was) and beancount configs (the kept account's wins). `mergeAccounts` locks both `users` rows in id order, runs `planMerge` + `applyMergePlan` (shared with claiming a placeholder) once per group the absorbed account has records or membership in, then moves **every** column pointing at `users.id`, the cascading ones (`auth_identities`, `sessions`, `group_delete_requests`, `user_beancount_configs`, `group_members`) before the delete; it clears the absorbed `telegram_id` before the kept row takes it, fills only the kept account's empty profile columns (`mergedProfileFields`), and deletes the absorbed user. A new `users.id` reference must be added there too. After commit the route logs `account_merged` once per group (`recordType: 'group'`, payload `accountMerged` with the rewritten `recordIds`, matched by `loadRecordHistory` like `member_claimed`), deletes "A → A" settlements when asked, and refreshes the newest chat cards with `refreshClaimedNotices`.

**In-app browsers**: Google answers `403 disallowed_useragent` inside LINE's / Telegram's built-in browser, so `/login` disables the Google button there (`isInAppBrowser`, `src/lib/in-app-browser.ts`) and `inviteLink` appends `?openExternalBrowser=1` so LINE opens shared links externally. LINE's button is listed first (it signs in without a prompt inside LINE).

Requests: the Mini App's store uses `tmaRawFetch` (`src/lib/tma-fetch.ts`, attaches the `tma` header); the Web App's uses `webRawFetch` (`src/lib/web-fetch.ts`, `credentials: "include"`, cookie-based).

### Database (`src/db/`)

Drizzle ORM + Neon Serverless Postgres. Tables defined in `src/db/schema.ts`:
`users` → `groups` (identified by `(chat_type, chat_id)`, see below) → `group_members` (join) → `expenses` → `expense_payers` + `expense_splits` + `expense_receipts` → `exchange_rates` + `group_exchange_rates` + `auth_identities` + `sessions` + `account_merge_tickets` + `receipt_awaiting` + `add_awaiting` + `group_delete_requests` + `group_invites` + `record_audit_log` + `user_beancount_configs` (per-user, per-group beancount account customisation; `UNIQUE(user_id, group_id)`, jsonb `person_accounts`).

**A group's chat is `(chat_type, chat_id)`**, not a Telegram-only column: `chat_type` is `'telegram'` today (room for other platforms), `chat_id` is text, both NULL together (`groups_chat_pair` CHECK) and `UNIQUE(chat_type, chat_id)`. **Never read or query these two columns directly — go through `src/lib/chat.ts`** (`telegramChatId(group)`, `requireTelegramChatId(group)`, `whereTelegramChat(id)`, `telegramChatColumns(id)`). A query that forgets `chat_type` doesn't error; it silently matches the wrong group once another platform issues the same id. `chatMigration` rewrites both columns when a chat is upgraded to a supergroup.

**Groups created on the web have no chat** (`chat_type`/`chat_id` both NULL) and are joined by invite code. Everything that talks to Telegram must go through `telegramChatId(group)` (nullable) rather than `requireTelegramChatId` (throws), and skip quietly on null: `notify.ts` sends no group message (the audit row is still written), `DELETE /api/groups/[id]` and `delete-request` POST/DELETE send/edit/leave nothing, and the avatar/photo routes skip `getChat` (the UI draws initials). `requireTelegramChatId` belongs only to bot-side code that runs inside a Telegram chat. A pending deletion of a web group is approved in the app: `DeleteRequestBanner` on the group page shows 同意/拒絕 to every member except the requester (the requester's own request stays in 群組設定 → 危險區域). It is shown for every group, not just web ones, because a member without Telegram can't see the buttons in the chat; it reads on mount and does not poll.

**A web group gets its chat later through `/link <邀請碼>`** (`src/bot/commands/link.ts`), typed in the Telegram group to bind. The decision is the pure `planLink` (`src/lib/link-plan.ts`): a wrong, revoked or expired code **and a sender who is not a member of that group** all get the same `INVITE_NOT_FOUND` text (a code only locates the group, it never admits anyone, and a reply must not say which codes exist); then a group that already has a chat is refused; then a chat already bound by an earlier `/link` (its group has a `chat_linked` audit row, so it is a real group even with no expenses) is refused with its own message; then a chat whose own `registerUser`-made row holds expenses is refused (two ledgers, manual merge, logged like `chatMigration`). Otherwise one transaction locks the web group `FOR UPDATE`, folds the chat's row in with `absorbGroup(…, { ex: tx, keepSurvivorCurrency: true })` (the row owns the `(chat_type, chat_id)` key, so it must go first; the web group's currency must win, the opposite of `chatMigration`'s case), then writes the pair via `telegramChatColumns`. It logs `chat_linked` (`recordType: 'group'`, payload `chatLinked` with the chat title). Pre-link records have no `notice_message_id` and are not re-sent; people already in the chat arrive through the usual membership tracking, never a batch add. Unlinking is not supported. Because the pair is an ordinary Telegram pair afterwards, `chatMigration` follows a later supergroup upgrade unchanged.

**Invites (`group_invites`, `src/lib/invite.ts` + `src/lib/invites.ts`)**: a group has at most one live code (`revoked_at IS NULL` and not expired), enforced by a partial unique index `group_invites_one_live_idx` and by `rotateInvite`, which locks the `groups` row (`FOR UPDATE`) before revoking the old code and inserting the new one in one transaction (a unique violation inside a transaction aborts it, so there is no retry; a code collision at 50 bits just throws). **Invites work for every group, Telegram ones included**: a member can have friends with no Telegram account, and the code is a member's deliberate act of sharing, unlike the content-derived guesses that `verifyInChat` guards against; resetting is how a member takes it back. Codes are Crockford base32, 10 characters (~50 bits), shown `K7M2Q-X9PAB`. There is **no rate limit** in this app, so the code length is the only defence against guessing: don't shorten it. Every unusable code (never issued, malformed, revoked, expired) returns the same 404 and text (`INVITE_NOT_FOUND`) so a response never says which codes exist, and the preview `GET /api/invites/[code]` requires login so it can't be used to enumerate. `invite.ts` builds the `/join/<code>` link and parses it back in one file (both ends of a contract); `POST /api/invites/[code]/accept` upserts `group_members` and flips `inactive` back to `active`, and logs `member_joined` only when the caller wasn't already an active member. `GET /api/groups/[id]/invite` is a pure read and answers `{ code: null }` for a group with none (everything created before invites existed): whoever presses 產生邀請碼 (`POST`) is the inviter on record, which a lazy mint on page view would get wrong. `POST` logs `invite_reset` only when it replaced a live code. `accept` decides in one statement (`INSERT … ON CONFLICT DO UPDATE … WHERE status <> 'active' RETURNING`) whether anything changed, so a double tap logs one `member_joined`. `INVITE_NOT_FOUND` lives in the DB-free `invite.ts` so the join page shows the server's exact words; only a 404 reads as invalid there, other failures offer a retry. `POST /api/groups` creates the group, the creator's membership and the first code in one transaction. Creating a group and entering a code (`groups/new`, `groups/join`, `join/[code]`) exist in **both** apps, and the code form continues under the app's own `basePath`, so a Mini App user never leaves Telegram's webview. The public share link is `/join/<code>`, outside `/app`, with its own `layout.tsx` that repeats the `/app` providers (a deliberate duplicate, like the other per-app layouts); a signed-out visitor goes through the store-wide 401 redirect to `/login?next=/join/<code>`. `GET`/`POST /api/groups/[id]/invite` also return `miniLink` (`joinLink` with the bot username from `src/lib/bot-username.ts`, null when unavailable) because the client has neither the bot username nor `TELEGRAM_MINI_APP_NAME`; `InviteSection` offers both links. A Mini App user sent a web link can still paste it into 輸入邀請碼 (`parseInviteCode` accepts a link).

**Placeholder members (no account)**: `users.placeholder_group_id` (non-NULL) marks a member who has only a name. It reuses the `users` row so payers, splits, FX, notices and the audit log need no changes; the one column says both "no account" and "belongs to this group" (FK `ON DELETE CASCADE`, so the group's deletion takes them too). They have no `telegram_id`, `auth_identities` or `sessions`, and the Auth.js adapter's `getUserByEmail` / `getUserByAccount` filter them out explicitly. Created by `POST /api/groups/[id]/members/placeholder` (user + `group_members` in one transaction), renamed by `PATCH …/members/[userId]` (placeholders only; names unique per group, `src/lib/placeholder.ts`; the check-then-write runs under a per-group advisory lock, `src/lib/member-name-lock.ts`, since the name lives on `users` and no single index can enforce it), removed by the existing `DELETE` (409 when they have records, and the `users` row goes with the membership). `GET …/members` returns `isPlaceholder`. `chatMigration`'s `absorbGroup` repoints `placeholder_group_id` before deleting the absorbed group, or the cascade would erase them.

**Claiming a placeholder (merge into a real account)**: `mergeUserInto(tx, groupId, fromId, toId)` (`src/lib/member-merge-db.ts`) folds a placeholder into a real member inside the caller's transaction; the decisions are the pure, unit-tested `src/lib/member-merge.ts` (`validateMerge`, `planMerge`, `summariseMerge`, `rekeyPersonAccounts`). `from.placeholderGroupId` must equal the group and `to` must be a real account. **Payer rows sum into `to`'s row** (`UNIQUE(expense_id, payer_id)`); **split rows have no unique key, so skipping the combine would not error, just leave two rows for one person**. `amount` always sums exactly, so balances never move. `share_type` follows the edit form, which reads it from the _first_ row and treats the expense as uniform: two `equal` rows become `shares` weight 2 and the other `equal` rows weight 1; `shares`/`percent` add their `split_value`; `exact` stays; anything the merge can't keep honest (`adjustment`, whose deltas are relative to an equal split that just shrank) flattens the **whole** expense to `exact`. **The merge writes in bulk, and refreshes chat cards afterwards.** Payer and split changes are one statement per kind (`UPDATE … FROM (VALUES …)` for the per-row amounts), not one per row, so a placeholder with hundreds of records doesn't hold the group lock for hundreds of round trips. Each rewritten record's chat message still names the placeholder, so after the response (`after()` from `next/server`) `refreshClaimedNotices` (`src/lib/claim-notices.ts`) edits the newest `CLAIM_NOTICE_LIMIT` (20, Telegram's per-minute cap for a group) of them with `updateRecordNotice(…, { repost: false })`: edit-only, so a record that never had a message doesn't get a first one posted by a merge. Older cards keep the name they were posted with.

**Settlements between the two people** become "A → A" (`findSelfSettlements`): the merger chooses in the dialog (`selfSettlements: "keep" | "delete"`, default `keep`; the invite accept path always keeps). `mergeUserInto` only reports their ids (`selfSettlementIds`); the merge route deletes them afterwards through `logDeleted`, so each deletion is audited and tombstoned in the chat like any other. A kept one cannot pass the settlement PATCH's from ≠ to rule, so `SettlementForm` shows a note and disables 儲存 for it (`initial.from.userId === initial.to.userId`) — delete-only. The transaction takes `lockGroupMemberNames`, locks the touched expenses `FOR UPDATE`, re-keys every `user_beancount_configs.person_accounts` in the group (the target's own entry wins), repoints the non-cascading `created_by`/`actor_id` columns, and deletes the `users` row. Entry points: `POST /api/groups/[id]/members/[userId]/merge` (body `{ intoUserId }`; `GET …?intoUserId=` is the read-only preview for the confirm dialog, `MergeMemberDialog` in 群組設定; any member may merge, no consent, irreversible by decision) and the optional `placeholderUserId` on `POST /api/invites/[code]/accept` (the join-and-claim runs in one transaction, so a refused claim rolls the join back; `GET /api/invites/[code]` lists `placeholders` for the "你是下面其中一位嗎？" picker in `JoinPage`, empty once the viewer is a member). The bot's `/join` and membership tracking seat people without the picker, which is why the members-list entry exists. It logs `member_claimed` (`recordType:'group'`, payload `memberClaimed` with the affected `recordIds`) **after** commit. The bot needs no change: 👥 誰分 reads `group_members`, and `profiles.ts` renders a null `telegramId` as plain text. `/add @handle` deliberately does not resolve them.

**One-person groups**: when the viewer is the only member, `GroupDetailPage` shows `SoloGroupCard` in place of the "all settled" banner (and the empty list says to add members first). The roster is read (`useGetMembersQuery`) only when `balance.balances` is empty — a lone member always nets zero, so no request is made for a group that visibly has other people. The roster is re-read on every mount (`refetchOnMountOrArgChange: true`) and neither the card nor the banner shows until it is current, so a cached roster from before someone joined can't put up a false card; inactive members count as members. The invite hint is `Platform.soloInviteHint`, since the Mini App's advice (paste the code into 輸入邀請碼) is Telegram-specific. The card has no dismiss: it disappears when `Members` is invalidated by adding a placeholder, or on the next read after an invite is accepted. It reuses `InviteActions` (the code, copy/share and issue controls that `InviteSection` also renders; `allowReset={false}` on the card, so replacing a live code stays in 群組設定 and a missing code is only ever issued by a tap) and `AddPlaceholderDialog` (the name dialog plus `addPlaceholderMember`, also used by 群組設定), so name errors and invite handling live in one place.

**Multi-payer model**: An expense has one or more payers in `expense_payers` (who paid, how much each) and one or more debtors in `expense_splits` (who owes, how much each). Both tables reference `expenses.id` with `ON DELETE CASCADE`. `expense_payers` has a `UNIQUE(expense_id, payer_id)` constraint. Both sides must sum to `expenses.amount`.

**Settlements are expenses**: A repayment ("A 還 B $X") is just a degenerate expense — A is the sole payer, B the sole debtor — with identical balance impact. It is stored in `expenses` with `type='settlement'` (vs `type='expense'`), one `expense_payers` row (= sender) and one `expense_splits` row (= receiver, `share_type='exact'`). There is **no** separate `settlements` table. The `type` column is the only discriminator: balance/FX/rate-lock treat both kinds the same (no branching), while the expense list/detail and stats filter `type='expense'` and the merged group list renders `type='settlement'` rows as `from → to`. The `/api/groups/[id]/settlements` routes are a from/to-shaped façade over `type='settlement'` expenses for the forms: `POST` creates and `[settlementId]` reads, edits and deletes one. There is no list `GET` — settlements appear inline in the main list at `GET …/expenses`.

`expenses.notice_message_id` holds the `message_id` of that record's message in the group chat — the expense card for an expense, the notice for a settlement (see Group notifications below). `NULL` for records predating the feature or when the send failed.

`receipt_awaiting` stores in-flight "waiting for receipt photo" state for the ForceReply bot flow (only triggered after text-only `/add`; not shown when photo is already attached via caption). `add_awaiting` stores in-flight ForceReply prompts: with `expense_id`/`field` NULL it's a bare `/add` waiting for expense text, otherwise the reply sets one field (`amount` / `currency`) of an existing expense and `panel_message_id` says which card to refresh.

Schema is pushed directly with `db:push` (no migration workflow). `numeric` columns come back as strings from Drizzle; use `n()` from `src/lib/money.ts` to parse them to numbers.

**Data migrations run in the Vercel build** (`scripts/vercel-build.sh`: `db:migrate` → `db:push` → `next build`, on production and on **every** preview — each branch has its own Neon database and the E2E run reads it, so a branch that adds a column would otherwise fail every case; only production and the `dev` preview also set the bot's commands and webhook, which are global to the one bot). `scripts/migrate.ts` applies each unrecorded file in `migrations/NNNN-name.ts` (`export default async function up(sql)`) and records it in `schema_migrations` (also declared in `schema.ts`, otherwise `db:push --force` drops it); a throwing migration fails the build, so the release never ships. Two rules, both because the previous release is still serving traffic while the build runs: a migration must be **idempotent** (there is no lock), and it must work against **both old and new code** — add, backfill and relax in one release, drop in a later one. `pendingMigrations` (`src/lib/migration-plan.ts`) is the pure, tested part. The one-off `scripts/migrate-*.ts` below predate the runner and were run by hand.

**Schema upgrade procedure** (when adding tables or dropping columns): if the change requires a data migration, add `migrations/NNNN-name.ts` — it runs in the next build, before `db:push`. Because `db:push --force` runs in that same build with the old release still live, **never remove a column or constraint the old code reads in the same release as the migration**: keep it in `schema.ts` (nullable, marked deprecated) and drop it in the next release. `migrations/0001-group-chat.ts` is the worked example, including a trigger that keeps rows the old code inserts mid-deploy in sync. The older `scripts/migrate-payers.ts` is the pre-runner style.

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

### Stats (`src/lib/stats-core.ts` + `GET /api/groups/[id]/stats`)

The stats page is personalised and range-scoped, not a fixed group-wide report. `GET /api/groups/[id]/stats?userId=&range=&from=&to=` takes:

- `userId` (optional, defaults to the caller) — the "查看視角" member being viewed. Must be a group member; checked with `assertGroupMember`, skipped when `userId` resolves to the caller themselves (already proven above) to save a redundant round trip. There's no per-record privacy model in this app (see the `createdBy` transparency decision below), so viewing another member's stats needs no extra permission.
- `range` — `3m` / `6m` (default) / `1y` / `all` / `custom`. `custom` additionally requires `from`/`to` as **full ISO instants, not bare "YYYY-MM-DD"** — only the browser knows the viewer's local day boundaries, so `customRangeToQueryBounds` (`stats-core.ts`) resolves "the day I clicked" to an exact UTC instant client-side before the request is sent; the route never reinterprets a bare date (that would silently use UTC midnight, excluding a viewer's early-morning records in any positive-UTC-offset timezone — this bit the first version of this feature). `DateRangeSelect` also uses `parseLocalDay` (not `new Date(str)`) to redraw the picker's own `selected` state for the same reason.

Same pure/DB split as settlement logic: `src/lib/stats-core.ts` (`resolveStatsRange`, `monthKeysBetween`, `recentMonthKeys`, `monthKeyToDate`, `parseLocalDay`, `customRangeToQueryBounds`, `computeNetTrend` — no DB, fully testable) resolves the range and does the tricky arithmetic; the route does the DB queries and FX conversion (`resolveRate`, same priority chain as balances) and calls into it.

The response has three sections, each answering a different question, and **two different notions of "the range" on purpose**:

1. **`netTrend`** — the viewed member's cumulative net balance (paid − split, settlements included since they're `expenses` rows too) plotted over time. This is the only place with a _history_ of the balance Balance itself only shows as one current number — the rightmost point always equals that current number. `computeNetTrend` anchors the series at the resolved `from` (an exact day-count window for presets, e.g. "180 days before now") with whatever total was carried in from before the window, rather than resetting to 0 — so a quiet window still renders a correctly-valued flat line instead of an empty chart. `all` anchors at the group's settlement-inclusive earliest record (a settlement is a real balance-changing event, so history starts there).
2. **`monthly`** — group-wide `type='expense'` totals per month (capped at `MAX_MONTHS = 24` bars regardless of range) plus the viewed member's `expense_splits` total for the same months — i.e. their _allocated share_, not what they paid. For presets, this uses `recentMonthKeys` — the last N _calendar_ months ending at the current month, always exactly N regardless of day-of-month (e.g. `6m` always shows exactly 6 bars, matching the help doc's "選 6 個月會看到 6 根長條") — **deliberately a different window than `netTrend`'s**: a bar chart reads "6 個月" as 6 labeled months, a continuous trend line as 6 months of days, and trying to force both charts onto one window produces either a wrong bar count or a wrong trend anchor. For `all`, the window starts at the earliest **expense** record specifically (not the settlement-inclusive one netTrend uses), so a group whose very first record happens to be a settlement doesn't pick up a run of zero-filled idle months before any real expense existed.
3. **`byPayer`** — same metric the page used to show as its only chart (each member's `expense_payers` contribution, i.e. who fronted the cash) — kept as a secondary section, but now scoped to the same `range` instead of always being all-time. **Always shares `monthly`'s window, not `netTrend`'s** — the two sections being consistent with each other is the invariant that matters, since they're reporting over "the same visible window," while `netTrend` is answering a different kind of question.

`byPayer`'s "who paid" and `monthly`'s "member's share" are deliberately different tables (`expense_payers` vs `expense_splits`) — conflating them would silently misrepresent one or the other. The page's member list/photos come from the existing `GET /api/groups/[id]/members` and `/avatars` endpoints rather than being duplicated into this response.

`DateRangeSelect` (`src/components/mini/DateRangeSelect.tsx`) and the view-as `MemberSelect` are shared components used by the one shared stats page body (`src/components/pages/GroupStatsPage.tsx`) that both `/mini` and `/app` render. `src/components/ui/calendar.tsx` gained `day_range_start` / `day_range_end` / `day_range_middle` classNames for the custom-range picker — `mode="range"` was previously unused in this codebase (only `mode="single"` in the expense/settlement date fields).

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

- **Deletes must snapshot first.** Call `loadNoticeRecord` _before_ deleting the row — the record, its creator and its `notice_message_id` are gone afterwards. Both the bot's `del_exp` callback and the API's `DELETE` do this.
- **The tombstone's attribution is load-bearing.** `formatDeletedNotice` names what went, who recorded it and who removed it. That is what stands in for the per-record owner lock this app deliberately doesn't have (see "Who may edit or delete a record") — don't quietly reduce it to "已刪除".
- **Silence is inherited.** Messages are silent because the bot's api middleware (`src/bot/index.ts`) stamps `disable_notification: true` on every `send*` call. Nothing in `notify.ts` sets it explicitly, so removing that middleware would un-silence every one of them.

Deep links: the card's 🔗 App 編輯 uses `?startapp=group_<chatId>_exp_<id>`, a settlement notice `_stl_<id>` — both parsed in `src/lib/auth/index.ts`, surfaced as `activeExpenseId` / `activeSettlementId` by `/api/me/groups`, and redirected in `GroupsHome` (`src/components/pages/GroupsHome.tsx`, shared by `/mini` and `/app`). A `startapp=join_<code>` link (`joinLink` in `deep-link.ts`) is the third payload: `parseStartParam` returns a `kind: "join"` result, `getAuth` carries only the normalised code as `inviteFromParam` (surfaced as `activeInviteCode`) and **never joins at auth time**, and `GroupsHome` sends the viewer to `<basePath>/join/<code>` so they see the preview and confirm. The 🗑 刪除 button on both is the same `del_exp:<id>` callback, group-scoped and (per the policy above) not owner-gated.

### Expense list pagination (`src/lib/expense-cursor.ts` + `getExpenses` in `src/store/api.ts`)

`GET /api/groups/[id]/expenses?cursor=` returns `{ expenses, nextCursor, total }`, `EXPENSES_PAGE_SIZE = 30` per page, ordered `(spent_at DESC, id DESC)`. `spent_at` is user-editable and not unique, so the cursor is the pair, built and parsed in `expense-cursor.ts`. The timestamp rides as **microsecond text** (`to_char … US`), not a JS `Date`: milliseconds would round the cursor down and skip rows sharing its millisecond. A malformed cursor — wrong shape, an impossible date such as Feb 31, or an id beyond int4 — is a 400, not a Postgres error. `expenses_group_list_idx` (`group_id, spent_at DESC, id DESC`) matches that order and the row-value cursor comparison, so a deep page seeks instead of sorting the group. `total` (every record, settlements included) is counted on the first page only and feeds the list header; with "只看我的" on, the header shows the filtered count of what is loaded with a `+` while more pages remain, because that filter is client-side.

Both the list page and the activity feed load further pages through `useAutoLoadMore` (`IntersectionObserver` on a sentinel, capped at 5 consecutive loads so a "只看我的" filter matching nothing can't drain a big group; the cap resets when the sentinel leaves view) and render `LoadMoreFooter`. Its 載入更多 button appears only as the fallback: no observer, a failed page, or the cap. A tap on the button re-arms auto-loading. A failed page or a failed refresh keeps the loaded list on screen and shows the button as a retry (it refetches when there is no next page).

### Audit log (`src/lib/record-mutation.ts` + `record-audit.ts` + `record-history.ts`)

Every create, edit and delete of a record is logged to `record_audit_log` with
who did it, from which surface, and a full before/after snapshot. This is the
accounting half of "any member may edit anything" — without it, relaxing the
owner lock would mean changes are both unrestricted _and_ untraceable.

**Audit and the group message are one layer, on purpose. Do not split them.**
`logCreated` / `logUpdated` / `logDeleted` write the log _and_ drive
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
  evidence. `group_id` _does_ cascade — deleting the group should take its log.
- **`src/bot/expenseEdits.ts` exists because of an import cycle.** `notify.ts`
  imports `expenseCard.ts` to render a card from a route handler, so that module
  has to stay a dependency-free leaf. Every bot write to an existing expense
  therefore lives in `expenseEdits.ts`, which may import `record-mutation.ts`.
- **Group-level membership events** use `recordType: 'group'` with no record id: `member_joined` (payload `{kind:'memberJoined', inviterId, inviterName}`, name captured as it was then), `invite_reset` and `member_claimed` (`memberClaimed`: the placeholder's name, claimer, and the rewritten `recordIds`, so `loadRecordHistory` can show it on each of those records via a `@>` check, like rate locks; the feed reads "X 認領了 Y", or "把 Y 合併到 Z" when the merger isn't the claimer). `GroupEventPayload` has its own guard (`isGroupEventPayload`); `record-history.ts` must branch on it before `summariseRecord`, which would otherwise read the payload as an expense snapshot.
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

### CSV 匯出 (`src/lib/csv.ts` + `src/lib/export.ts`)

A group's records (expenses **and** settlements, one row each) export as CSV through three entry points sharing `buildGroupExport`: the bot's `/export` (`sendDocument` into the chat), `GET /api/groups/[id]/export?format=csv` (the Web App's download, via `Platform.canDownloadExport`), and `POST /api/groups/[id]/export/send` (the settings row in both apps, which has the bot post the file in the group chat).

- **The Mini App has no direct download on purpose**: `WebApp.downloadFile`/`openLink` take a URL Telegram fetches itself, so they cannot carry the `tma` header. Posting to the chat avoids a signed-URL scheme.
- **換算金額 is kept at 4 decimals** (`FX_DP` in `export.ts`) and goes through `resolveRate`, the same chain `computeGroupBalances` uses. Rounding each row to 2 dp would let the column sum drift from `/balance`, which rounds once at the end.
- `csv.ts` is pure and tested: UTF-8 BOM (Excel), CRLF, quoting, and a `'` prefix on text starting with `= + - @` because descriptions are user-controlled (formula injection). Timestamps are UTC since the schema has no group timezone.

### Beancount 匯出 (`src/lib/beancount.ts`)

A single record (expense or settlement) can be copied as a beancount transaction via the **`Bean` icon button** in the top-right of the expense/settlement edit form header (`CopyBeancountButton`, edit mode only). The output is from the **personal-ledger perspective** of the current user (U):

- `Expenses:Uncategorized` — U's own share (the schema has no category, so the default is a fixed account; the user re-categorises after pasting).
- `Assets:Cash` — cash U fronted (negative).
- `Assets:Receivable:<X>` — net position with each other person X (positive = X owes U, negative = U owes X). U's net is allocated proportionally across the opposite-sign counterparties, so multi-payer records stay balanced and only reflect U's own legs. Settlements skip the Expenses leg and just move cash ↔ receivable.

The three account prefixes above are the **defaults** (`DEFAULT_BEANCOUNT_ACCOUNTS`). The feature is **opt-in per (user, group)**: a user enables it on its own standalone settings page (`/{mini,app}/groups/[id]/settings/beancount`, reached via a nav row from the group settings page — not an inline section there anymore, issue #59), which writes a `user_beancount_configs` row (`expenses_account`, `cash_account`, `receivable_prefix`, and a jsonb `person_accounts` map of memberUserId→account leaf). **No row = feature off**, so `CopyBeancountButton` (which reads `GET /api/groups/[id]/beancount` through the store) renders nothing and the button stays hidden. The config is personal — it only affects the setter, not other members of the same group. CRUD is `GET/PUT/DELETE /api/groups/[id]/beancount`, keyed on `(auth.user.id, groupId)`; account strings are zod-validated against `BEANCOUNT_ACCOUNT_RE` / `BEANCOUNT_LEAF_RE`.

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
- `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`, `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, `AUTH_LINE_ID` / `AUTH_LINE_SECRET` — optional; each provider is enabled only when its pair is present

All route handlers must set `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"` because they use the Neon serverless driver.

### Git conventions

Commit subjects and PR titles follow **Conventional Commits**: `type(scope): imperative description`, lowercase after the colon, no trailing period, subject ≤72 chars.

- Types in use: `feat`, `fix`, `chore`, `ci`, `docs`, `refactor`.
- Scope is optional and names an area rather than a file — `bot`, `mini`, `deps`.
- The body carries the _why_. Explanations that a user can't act on belong here, not in the bot's replies (see `src/bot/commands/help.ts`).
- Every PR names its issue in the PR description, on its own line: `Closes #N` when it completes the issue (GitHub closes it when the PR merges into `dev`), `Part of #N` when it is one step of a larger issue, or `No-issue` when none applies. A plain mention such as `See #N` links the issue but leaves it open. When the last checkbox of an issue is ticked outside such a merge, close the issue in the same step.

The prefix is for humans only: the release workflow's semver bump is a manual `workflow_dispatch` input (`.github/workflows/merge-dev-to-main.yml`), **not** parsed from commit types, so a wrong prefix can't mis-release anything.

### Deployment

Production runs on **Vercel** (frontend + bot webhook + API in one deploy), served from a **custom domain** (not the default `*.vercel.app`), backed by **Neon Postgres**, with the Mini App registered in **BotFather**. The repo is `chiachunho/splitbill-telegram-bot` (private); `origin` is HTTPS. The **default branch is `dev`** — open all PRs against `dev`, not `main`. Pushing to the default branch triggers Vercel auto-deploy. Full step-by-step in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Node runtime is **24.x**, pinned in two places that must agree: `engines.node` in `package.json` (Vercel reads this and it overrides the dashboard's Node.js Version setting) and `.nvmrc` (CI's `setup-node` reads it via `node-version-file`). Vercel only honours the major version and patches it on its own, so a security release on that line (e.g. CVE-2026-111497 "Node2Shell", fixed in 24.22.1) is picked up on the next deploy, not by editing the pin. CI mirrors that with `check-latest: true` — without it `setup-node` silently uses whatever 24.x the runner image has cached, which lagged behind the Node2Shell fix.

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

Vitest with `vite-tsconfig-paths`. Tests live in `src/lib/__tests__/`, `src/lib/auth/__tests__/`, `src/components/**/__tests__/` and `scripts/__tests__/` (the `.mjs` tools under `scripts/`). Pure lib functions are the bulk of the unit tests; API routes and bot commands are not tested. The vitest config injects dummy env vars so modules that import `@/db` don't throw during test collection.

**Component tests** (`*.test.tsx`) render shared components under jsdom: `environmentMatchGlobs` in `vitest.config.ts` runs `src/components/**` in jsdom and everything else in node, so lib tests don't pay jsdom's startup cost. `esbuild.jsx` is set to `automatic` because the tsconfig's `"jsx": "preserve"` otherwise makes every `.tsx` test fail with "React is not defined". Each such file imports `@testing-library/jest-dom/vitest` and calls `cleanup` itself, since vitest globals are off. Assert only what a user sees — text, link targets, whether an element or link exists, disabled state — never Tailwind classes or DOM structure, which break on every restyle. Cover the guards that fail silently (a link that must not exist, a grouping that quietly stops). Big forms such as `ExpenseForm` are not covered yet.

**E2E (Playwright)** lives in `e2e/` and runs against an already-deployed site, never a local server. `pnpm e2e` reads `E2E_BASE_URL` (defaults to `http://localhost:3000`) and `E2E_DATABASE_URL`, the DB that site uses. Only `/app` is covered for now; `/mini` needs a signed initData and is not tested yet. Web login can't be automated, so `e2e/fixtures.ts` seeds the signed-in user with a `sessions` row and sets the `session` cookie. It also seeds a second group member (no session), an outsider who is not in the group, a second group the user is not in, and one 300 expense split 150/150 between the two members. Everything is deleted on teardown. In CI, `.github/workflows/e2e.yml` runs on every successful Vercel Preview deployment, using the commit Vercel built. Each git branch has its own Neon database, created by the Neon Vercel integration, and Vercel exposes that URL only as a value CI cannot read. So the workflow looks up the branch's connection URI through the Neon API (the repo secret `NEON_API_KEY` and the repo variable `NEON_PROJECT_ID`), by the deployment's branch name, and sets `E2E_DATABASE_URL` from it. That keeps the seeded rows in the same database the preview reads.

**New features need E2E cases.** A change that alters a user-visible `/app` flow (a page, a form, a balance or settle-up rule, or an API the UI depends on) adds or updates a case in `e2e/` in the same PR. Test names are in English; the UI strings they match stay in Chinese. Each case seeds its own data through `e2e/fixtures.ts` and removes it on teardown, so no case depends on another's state.

Each E2E run posts its result to the PR through `scripts/e2e-pr-comment.mjs`. It is one comment, updated in place on every run (marked `<!-- e2e-results -->`), listing pass, fail, skip and flaky counts per spec and the first lines of each failure. A failing run still posts, then fails the job.
