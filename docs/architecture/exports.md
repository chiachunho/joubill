# CSV and beancount exports

Moved out of `CLAUDE.md`, which keeps a short list of the rules that are easiest to break and links here. When the behaviour changes, update both.

## CSV 匯出 (`src/lib/csv.ts` + `src/lib/export.ts`)

A group's records (expenses **and** settlements, one row each) export as CSV through three entry points sharing `buildGroupExport`: the bot's `/export` (`sendDocument` into the chat), `GET /api/groups/[id]/export?format=csv` (the Web App's download, via `Platform.canDownloadExport`), and `POST /api/groups/[id]/export/send` (the settings row in both apps, which has the bot post the file in the group chat).

- **The Mini App has no direct download on purpose**: `WebApp.downloadFile`/`openLink` take a URL Telegram fetches itself, so they cannot carry the `tma` header. Posting to the chat avoids a signed-URL scheme.
- **換算金額 is kept at 4 decimals** (`FX_DP` in `export.ts`) and goes through `resolveRate`, the same chain `computeGroupBalances` uses. Rounding each row to 2 dp would let the column sum drift from `/balance`, which rounds once at the end.
- `csv.ts` is pure and tested: UTF-8 BOM (Excel), CRLF, quoting, and a `'` prefix on text starting with `= + - @` because descriptions are user-controlled (formula injection). Timestamps are UTC since the schema has no group timezone.

## Beancount 匯出 (`src/lib/beancount.ts` + `beancount-export.ts`, issue #117)

A member can export the group as a beancount file **from their own personal-ledger perspective** (U). It is personal: it never goes to the group chat, and the accounts only affect the person who set them. There is no per-record copy button any more, and no on/off switch.

Every record becomes at most one transaction with three accounts:

- **Expenses** (default `Expenses:Uncategorized`): U's own share.
- **Cash** (default `Assets:Cash`): cash U moved.
- **Event** (default `Assets:Receivable:<group title>`, `defaultEventAccount`): everything between U and the rest of the group, in **one** account, whose balance is U's net in the group, the same figure as /balance. An expense posts `+owed`, `−paid`, `paid − owed` (computed from the two rounded legs, so it always balances); a settlement moves Cash ↔ Event. A record that doesn't touch U (another pair's settlement, an expense U is not on, an "A → A" left by a merge) is skipped.

**One event account instead of one receivable per person, on purpose.** Settle-up suggestions minimise transfers (`settlement-core.ts`), so they routinely have U pay someone U never owed directly; per-person receivables then never return to zero after U is fully settled. The app already shows who owes whom, so the ledger doesn't repeat it.

- `recordPostings` / `recordToBeancount` / `groupToBeancount` are **pure** and unit-tested (`src/lib/__tests__/beancount.test.ts`). The file has a comment header, the `open` directives (Event live only when the file starts the ledger, i.e. 全部 or a first export, since a second `open` is a beancount error; Expenses / Cash always commented out, since the user's ledger almost certainly has them) and a `splitbill_id` metadata line per transaction for deduplicating re-imports. A foreign-currency record gets `@ <rate> <quote>` on every posting.
- **Loading is shared with the CSV**: `loadGroupRecords` (`src/lib/export.ts`) reads records, legs, names and rates for both, so the two exports can't disagree about rates (`resolveRate`, the /balance chain). It takes a `where` (the range) and `rates: false` for the count-only summary.
- **Ranges** (`src/lib/beancount-range.ts`, built and parsed in one file): `new` = records whose `created_at` is after the user's `last_exported_at` (creation time, not spending date, so a back-dated record is still picked up; compared at millisecond precision because the watermark went through a JS `Date`), `all`, and `custom` by `spent_at` with full ISO instants (the browser resolves its own day boundaries, like the stats page). Only `new` and `all` move the watermark, to the newest exported `created_at`, through `greatest()` so it never goes backwards; a custom range is a one-off look back. Records edited or deleted after an export are not re-exported (the page and the help say so; `splitbill_id` finds them).
- **Routes**: `GET/PUT /api/groups/[id]/beancount` (the three accounts; GET fills unsaved ones with defaults through `resolveBeancountAccounts`, so there is no "not enabled" state), `GET …/beancount/export?range=` (the file, the Web App's download), `GET …/export/summary?range=` (counts, watermark and `telegramLinked`, for the page), `POST …/export/send` (the bot `sendDocument`s the file to the caller's own `telegram_id`; a 403 from Telegram means they never started the bot and is answered with how to fix it). The watermark moves only after the file was built (download) or sent.
- **Pages**: 群組設定 → Beancount has two rows, 帳戶設定 (`/settings/beancount`, `BeancountSettingsSection`: three fields, 儲存 disabled while the form equals the saved copy, 已儲存 shown until the next edit) and 匯出 beancount (`/settings/beancount/export`, `BeancountExportSection`). The export page offers 上次匯出後 only once there is a watermark and starts on it, else on 全部; 下載 only where `Platform.canDownloadExport`, 傳到我的私訊 only when `telegramLinked`. The custom picker is `DateRangePicker`, shared with the stats page's `DateRangeSelect`.
- `user_beancount_configs`: `event_account` NULL means the default; a row is created by the first save or the first export (for the watermark), and that export pins an unsaved `event_account` to the default it used, since the default follows the group title and a rename would otherwise move later 上次匯出後 files to an account the ledger never opened. The per-person `receivable_prefix` / `person_accounts` columns from before issue #117 have been dropped.
