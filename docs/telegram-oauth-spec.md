# Telegram OAuth / OIDC login spec

> 中文版：[telegram-oauth-spec.zh-TW.md](telegram-oauth-spec.zh-TW.md)

> A summary of Telegram's OAuth2 + PKCE login spec, how it deviates from
> standard OIDC, and the matching handling in [`src/auth.ts`](../src/auth.ts).
>
> Source: [core.telegram.org/bots/telegram-login](https://core.telegram.org/bots/telegram-login)
> Credentials: BotFather → Bot Settings → Web Login → Client ID / Secret

---

## Endpoints

| Purpose        | URL                                                           | Method |
| -------------- | ------------------------------------------------------------- | ------ |
| Authorization  | `https://oauth.telegram.org/auth`                             | GET    |
| Token Exchange | `https://oauth.telegram.org/token`                            | POST   |
| JWKS           | `https://oauth.telegram.org/.well-known/jwks.json`            | GET    |
| Discovery      | `https://oauth.telegram.org/.well-known/openid-configuration` | GET    |

The discovery document has **no `userinfo_endpoint`** — the biggest difference
from a normal OIDC provider (see "Gotchas" below).

---

## Authorization request (GET query params)

**Required:**

| Param                   | Notes                                                 |
| ----------------------- | ----------------------------------------------------- |
| `client_id`             | the Bot ID from BotFather                             |
| `redirect_uri`          | a pre-registered callback URL                         |
| `response_type`         | always `code`                                         |
| `scope`                 | space-separated (see Scopes)                          |
| `code_challenge`        | SHA256 of the code verifier, Base64URL-encoded (PKCE) |
| `code_challenge_method` | always `S256`                                         |

**Optional:**

| Param   | Notes                                                  |
| ------- | ------------------------------------------------------ |
| `state` | random CSRF string. **~128-char limit** (see gotcha 1) |
| `nonce` | random anti-replay string                              |
| `lang`  | UI language (e.g. `en`, `zh`)                          |

---

## Token request (POST `application/x-www-form-urlencoded`)

**Client auth:** `Authorization: Basic <base64(client_id:client_secret)>`
(discovery advertises both `client_secret_basic` and `client_secret_post`)

**Required body:**

| Param           | Notes                                           |
| --------------- | ----------------------------------------------- |
| `grant_type`    | always `authorization_code`                     |
| `code`          | the authorization code from the redirect        |
| `redirect_uri`  | must equal the one in the authorization request |
| `client_id`     | Bot ID                                          |
| `code_verifier` | the original PKCE verifier                      |

**Response:**

```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "id_token": "eyJhbGciOiJ..."
}
```

---

## Scopes

| Scope                 | Claims returned                         | Notes              |
| --------------------- | --------------------------------------- | ------------------ |
| `openid`              | `sub`, `iss`, `iat`, `exp`              | required           |
| `profile`             | `name`, `preferred_username`, `picture` | optional           |
| `phone`               | `phone_number`                          | needs user consent |
| `telegram:bot_access` | none (lets the bot DM the user)         | optional           |

This project uses `openid profile` (no email/phone needed; Telegram never
provides email anyway).

---

## ID token claims

All user data is delivered **only through the id_token — there is no UserInfo endpoint**:

```jsonc
{
  "iss": "https://oauth.telegram.org",
  "aud": "<bot_id>",
  "sub": "<user_id>",
  "iat": 1700000000,
  "exp": 1700003600,
  "id": 123456789, // numeric user id
  "name": "<full name>",
  "preferred_username": "<username>",
  "picture": "<profile photo url>",
  "phone_number": "<verified number>", // only with the phone scope
}
```

> Only claims matching the requested scopes are included.

> ⚠️ **`sub` ≠ `id`**: `sub` is the OIDC per-bot pairwise identifier, **not** the
> Telegram numeric user id; the real user id is in the `id` claim. The Mini App
> (initData) uses `id`, so web OIDC must also use `id` as `providerUid` — otherwise
> the same person becomes two identities / two users. Our `profile()` therefore
> returns `id: String(profile.id)`.

**id_token signing algorithms** (discovery `id_token_signing_alg_values_supported`):
`RS256`, `ES256`, `EdDSA`, `ES256K`.

---

## Required verification steps (per the docs)

1. Fetch the public keys from the JWKS endpoint
2. **Verify the JWT signature** with the public key
3. Verify claims:
   - `iss` must equal `https://oauth.telegram.org`
   - `aud` must equal your own Bot ID
   - `exp` not expired

---

## Gotchas (differences from standard OIDC)

These three are exactly the errors we hit in a row while implementing; recorded
so we don't repeat them.

### 1. `state` too long → `state too long`

Telegram caps the `state` param at **~128 chars**, but Auth.js's default state is
a JWE-encrypted blob 400+ chars long.
→ **Fix:** drop the `state` check, keep only `pkce`. PKCE (RFC 7636) already
provides equivalent CSRF protection.

### 2. No UserInfo endpoint → `Authorization server did not provide a userinfo endpoint`

Auth.js's `type: "oidc"` provider runs discovery and throws when the discovery
doc lacks `userinfo_endpoint` (`@auth/core` callback.ts). Telegram's discovery
doc has no such field.
→ **Fix:** use `type: "oauth"`. The oauth branch calls `userinfo.request()`
instead, letting us pull claims from the id_token ourselves.

### 3. `InvalidEndpoints: missing both issuer and userinfo`

With `type: "oauth"` and no `issuer`, Auth.js's config assertion requires
`authorization` / `token` / `userinfo` to all have a `url`. Our `userinfo` only
has `request`, no `url`.
→ **Fix:** add `issuer`, which makes that assertion skip entirely; and because
`token` has a URL the callback still takes the "manual branch" rather than
discovery, so `userinfo.request()` is still called.

### 4. (browser-side) COOP header

The docs warn: if the site sends `Cross-Origin-Opener-Policy: same-origin`, it
blocks the Telegram login library. Use `same-origin-allow-popups` or remove that
header.

---

## How our implementation maps to this

The `TelegramOIDC` provider in [`src/auth.ts`](../src/auth.ts):

```ts
type: "oauth",                       // gotcha 2: avoid OIDC discovery
issuer: "https://oauth.telegram.org",// gotcha 3: pass the endpoint assertion
authorization: { url: ".../auth", params: { scope: "openid profile" } },
token: ".../token",                  // has a URL → callback takes the manual branch
checks: ["pkce"],                    // gotcha 1: drop state
userinfo: {
  // No UserInfo endpoint → take claims from the id_token, verify sig against JWKS
  request: ({ tokens }) =>
    jwtVerify(tokens.id_token, telegramJwks, {
      issuer: "https://oauth.telegram.org",
      audience: process.env.AUTH_TELEGRAM_CLIENT_ID,
    }).then((r) => r.payload),
},
profile: (p) => ({ id: String(p.id) /* use id, not sub, to match the Mini App */, ... }),
```

Env vars: `AUTH_TELEGRAM_CLIENT_ID`, `AUTH_TELEGRAM_CLIENT_SECRET`.
