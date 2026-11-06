# MCP server (issue #147, phase 1: issue #149)

`POST /api/mcp` is a sixth front end next to the REST API and the bot. It shares
`src/lib/records/` for writes (issue #148), so a linked application's record gets the same audit row,
group message and push as any other.

## Transport

Stateless Streamable HTTP with the SDK's web-standard transport (`sessionIdGenerator:
undefined`, `enableJsonResponse: true`). A new `McpServer` is built per request
(`src/lib/mcp/server.ts`), closed over the caller's `McpAuth`. `GET` and `DELETE` answer
405: there is no session to stream to, and an open SSE stream would pin an invocation.

## Identity

`getMcpAuth` (`src/lib/auth/mcp.ts`) accepts `Authorization: Bearer sbk_…` (a personal token) or
`Bearer sbo_…` (an OAuth access token, see below), hashes it (`src/lib/mcp-token.ts`, sha256) and
looks the hash up in `mcp_connections` / `oauth_tokens`. Revocation and expiry are checked **every
call**. A 401 carries `WWW-Authenticate: Bearer resource_metadata="…"`.
**`getAuth` does not accept either kind**, so REST stays closed to linked applications and a token can't
manage tokens (`mcp-token-not-session.test.ts`).

Every tool runs `openGroup` (`src/lib/mcp/context.ts`): count the call against the rate limit,
`assertGroupMember` (the owner's _current_ membership, so leaving a group ends the token's
access to it), then `assertGrant` (`src/lib/mcp-grant.ts`: the connection's group scope and
`read`/`write`). `all_groups` includes groups joined later.

## OAuth (issue #152)

Claude.ai and ChatGPT can't send a custom header, so `/api/mcp` is also an OAuth 2.1 resource
(MCP authorization spec). A 401 carries `WWW-Authenticate: Bearer resource_metadata="…"`, with
`error="invalid_token"` when a token was sent and refused (the cue to refresh).

- **Discovery**: `/.well-known/oauth-protected-resource` and `oauth-authorization-server` (optional
  catch-all, so the path-suffixed forms resolve too). Documents are built in `oauth-http.ts` from
  `NEXT_PUBLIC_MINI_APP_URL`'s origin, like `appUrl`.
- **Endpoints** (`src/app/api/oauth/`): `register` (RFC 7591, open on purpose), `authorize`, `token`,
  `revoke`, and `consent` (cookie-authenticated, used only by the consent page). `register`, `token`
  and `revoke` answer any origin (browser clients, no cookie); `consent` does not, and its POST
  checks `Origin`.
- **PKCE `S256` is mandatory**; `plain` is refused. Redirect URIs match exactly: https, loopback http,
  or an app's own scheme (`oauth.ts`: `isAcceptableRedirectUri`). A bad `client_id` / `redirect_uri` is
  an error page and **never a redirect**; any other error goes back to the (trusted) redirect URI.
- **Registration grants nothing.** Access exists only after a signed-in person approves on
  `/app/oauth/consent`. The client's name is attacker-controlled and ends up in "透過 X 記錄", so
  `sanitizeClientName` cleans it, and the consent page prints the redirect host. Registration is rate
  limited per address, capped (`MAX_CLIENTS`), and unused old clients are swept.
- **The grant travels in the code** (`oauth_codes`: 10 min, single use, claimed with an atomic
  `used_at`). The `mcp_connections` row (`kind = 'oauth'`, `token_hash` NULL) is created when the code
  is **exchanged**, so an abandoned approval leaves nothing in 連結的應用程式. Authorizing the same
  client again revokes its previous connection. A replayed code revokes what it produced.
- **Tokens** (`oauth_tokens`, hashes only): access `sbo_…` 1 h, refresh `sbr_…` 90 d. Refresh rotates;
  presenting a spent refresh token revokes the connection. `getMcpAuth` takes an `sbk_` token or an
  `sbo_` access token and returns the same `Grant`, so no tool changes. A spent refresh token is kept 7
  days (`sweepTokens`) so its replay is still recognised; deleting it on rotation would make the
  revoke-on-reuse rule unreachable. Issuing a grant (revoke the old connection, create the new one,
  its tokens) is one transaction. Revoking in settings,
  `/api/oauth/revoke` and leaving a group all end access through the usual checks.
- Scopes `records:read` / `records:write` only cap what the consent page offers; the group scope and
  the final permission are what the person chose there. **The page starts on 唯讀** even when the
  client asked to write, like the token form: a person who only picks a group and presses 允許 grants
  the narrowest access, and turns write on deliberately. It reads and decides through RTK Query
  (`getOauthConsent`, `decideOauthConsent`), like every other page.
- The consent page is `OAuthConsentPage`; the Mini App's route exists but only says it isn't
  supported (OAuth can't run in Telegram's webview) and offers `openInBrowser`.

## Connections

`mcp_connections` stores the hash and a display prefix, never the token. `POST
/api/me/mcp-connections` returns the plaintext once. `DELETE …/[id]` sets `revoked_at`; the
row stays so `record_audit_log.mcp_connection_id` (`ON DELETE SET NULL`) keeps a name. At
most 20 live connections per user. `mergeAccounts` moves `mcp_connections.user_id`.
`PATCH …/[id]` changes only the permission and the group scope (`updateConnectionSchema`: `allGroups` and
`groupIds` travel together); never the name, which audit entries quote, nor the expiry, since a
longer one is a new token. A revoked connection answers 404. The client side is the
`McpConnections` tag in `src/store/api.ts` (issue #150).

## Tools

Read: `list_groups`, `get_group`, `get_balance`, `list_records`, `get_record`. Write:
`add_expense`, `add_settlement`, `update_record`, `delete_record`.

- **Agent-facing text** (issue #151): the server `instructions` live in `src/lib/mcp/instructions.ts`,
  every tool has a description saying when to use it and its defaults, and every write tool takes
  `dryRun` (counted against the read bucket). A name error's `message` lists the candidates and the
  next step (`describeUnresolved`), and `NEXT_STEP` (`result.ts`) appends one to `forbidden`,
  `rate_limited`, `conflict` and the rest, because the agent may see only the message.
- **`update_record`** overlays the arguments on the stored record (`mcp-edit.ts`): a sole payer and
  an equal / shares split follow a new total; several payers or a per-person split must be re-sent
  when the amount moves, never guessed. It needs `expectedUpdatedAt` (from `get_record`). A stale one
  is `conflict` with the current record; the check is repeated inside the row-locked transaction
  (`assertUnchangedSince`), so two writers cannot both pass it. A split with per-person values
  (percent, adjustment, exact) is written back as it was while the amount is unchanged (`keep` in
  `mcp-split.ts`), so a description-only edit cannot flatten it. An active pinned rate is kept while
  the currency stays the same.
- **`delete_record`** is `destructiveHint`, previews with `dryRun`, and goes through `deleteRecord`,
  so the group message becomes the tombstone naming the connection.

- **Data twice, prose never.** Every result has `structuredContent` and the same data as a
  JSON text block in `content` (`src/lib/mcp/result.ts`), because some clients show a model
  only `content`; without it an error would read as a bare code and a list as a count. The
  first text block stays a fixed sentence of ids and numbers, so free text (descriptions,
  names) is only ever a string value inside the JSON, which the server `instructions` call
  data. The threat model adds no new source: any member can already write any description.
- **Names are matched exactly** (`src/lib/mcp-names.ts`: display name, Telegram name,
  username; NFKC, case-folded, `@` ignored; no prefix matching), only among the group's
  members. No match or several → `member_not_found` / `member_ambiguous` with candidates and
  nothing written. A `memberId` skips matching; `"me"` is the caller.
- `add_expense` amounts accept the bot's `/add` grammar (`parseMcpAmount`); splits are built
  by the pure `buildExpenseInput` and still pass `expenseInputSchema`, so sums can't drift from
  the forms. `dryRun` previews and counts against the read bucket.
- **Idempotency** (`mcp_idempotency`, `UNIQUE(connection_id, key)`, 24 h): the insert is the
  lock. A repeat returns `status: "duplicate"` with the original `recordId`; a repeat while
  the first call runs is `in_progress`. A failed or held call releases its key.
- **Possible duplicates**: same group, amount, currency and sole payer within 10 minutes is
  _not written_; the result is `status: "possible_duplicate"` with `possibleDuplicateOf`.
  Resend with `allowDuplicate: true` to record it anyway.
- **Rate limits** per connection, in Postgres (`rate_limit_hits`): 600 reads and 60 writes an
  hour, fixed windows. A refusal is a `rate_limited` tool error; `retryAfterSeconds` is the
  full window, as with the invite limits.

## Saying where a record came from (issue #150)

A person's own entry says nothing; a linked application's says so everywhere the record shows up. The
source is **derived from the audit log**: `loadCreatedVia` (`src/lib/record-via.ts`) joins the
record's `created` row (`source = 'mcp'`) to `mcp_connections.name`, so there is no second
copy on `expenses` to drift. `ActivityEntry.via` does the same join per row for edits.

- Group card and settlement notice: `✦ 小明 透過 Claude 記錄` (`formatMcpLine`), under the
  splits and in every card mode.
- Tombstone: `…，原本由 A 透過 Claude 記錄` and `— B 透過 我的 n8n` for the deleter
  (`logDeleted` looks the connection up from the actor).
- Forms: 由 X 透過 Claude 於 T 記錄 / 最後由 Y 透過 Claude 於 T 修改.
- Push: the actor's name carries the connection (`PushNoticeInput.via`).
- Group feed: the row says 透過 X and its avatar has a corner mark; the filter 全部 / 手動記錄 /
  透過應用程式 is `?source=` on `GET …/activity` (`mcp` = `source = 'mcp'`, `manual` = everything else,
  group events included). It is server-side because a page of 30 that a client filter empties would
  look like the end of the feed.

A connection is revoked, never deleted (except with its account), so the name stays readable.
Records entered before the feature, or by a person, show nothing.

## Testing

Pure parts are unit-tested (`mcp-*.test.ts`); `src/app/api/__tests__/mcp-route.test.ts`
drives the real SDK transport without a database; `e2e/mcp.spec.ts` covers the database work.
