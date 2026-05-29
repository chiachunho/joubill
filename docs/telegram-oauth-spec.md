# Telegram OAuth / OIDC 登入規格

> Telegram 的 OAuth2 + PKCE 登入規格摘要，以及它與標準 OIDC 的差異、我們在 [`src/auth.ts`](../src/auth.ts) 中對應的處理。
>
> 來源：[core.telegram.org/bots/telegram-login](https://core.telegram.org/bots/telegram-login)
> 憑證取得：BotFather → Bot Settings → Web Login → Client ID / Secret

---

## Endpoints

| 用途 | URL | Method |
|------|-----|--------|
| Authorization | `https://oauth.telegram.org/auth` | GET |
| Token Exchange | `https://oauth.telegram.org/token` | POST |
| JWKS | `https://oauth.telegram.org/.well-known/jwks.json` | GET |
| Discovery | `https://oauth.telegram.org/.well-known/openid-configuration` | GET |

Discovery document **沒有 `userinfo_endpoint`** — 這是與一般 OIDC 最大的差異（見下方「踩雷點」）。

---

## Authorization Request（GET query params）

**必填：**

| 參數 | 說明 |
|------|------|
| `client_id` | BotFather 給的 Bot ID |
| `redirect_uri` | 預先註冊的 callback URL |
| `response_type` | 固定 `code` |
| `scope` | 空白分隔（見下方 Scopes） |
| `code_challenge` | code verifier 的 SHA256，Base64URL 編碼（PKCE） |
| `code_challenge_method` | 固定 `S256` |

**選填：**

| 參數 | 說明 |
|------|------|
| `state` | CSRF 防護隨機字串。**長度上限約 128 字元**（見踩雷點 1） |
| `nonce` | 防 replay 的隨機字串 |
| `lang` | UI 語言（如 `en`、`zh`） |

---

## Token Request（POST `application/x-www-form-urlencoded`）

**驗證方式：** `Authorization: Basic <base64(client_id:client_secret)>`
（Discovery 宣告支援 `client_secret_basic` 與 `client_secret_post`）

**必填 body：**

| 參數 | 說明 |
|------|------|
| `grant_type` | 固定 `authorization_code` |
| `code` | redirect 帶回的 authorization code |
| `redirect_uri` | 必須與 authorization request 相同 |
| `client_id` | Bot ID |
| `code_verifier` | 原始 PKCE verifier |

**回應：**

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

| Scope | 回傳的 claims | 備註 |
|-------|--------------|------|
| `openid` | `sub`, `iss`, `iat`, `exp` | 必填 |
| `profile` | `name`, `preferred_username`, `picture` | 選填 |
| `phone` | `phone_number` | 需使用者同意 |
| `telegram:bot_access` | 無（啟用 bot 可私訊使用者） | 選填 |

本專案使用 `openid profile`（不需要 email/phone；Telegram 本來就不給 email）。

---

## ID Token Claims

所有使用者資料**只透過 id_token 提供，沒有 UserInfo endpoint**：

```jsonc
{
  "iss": "https://oauth.telegram.org",
  "aud": "<bot_id>",
  "sub": "<user_id>",
  "iat": 1700000000,
  "exp": 1700003600,
  "id": 123456789,             // 數字型 user id
  "name": "<full name>",
  "preferred_username": "<username>",
  "picture": "<profile photo url>",
  "phone_number": "<verified number>"  // 僅 phone scope
}
```

> 只有符合所申請 scope 的 claims 會被包含。

> ⚠️ **`sub` ≠ `id`**：`sub` 是 OIDC 的 per-bot pairwise 識別碼，**不是** Telegram 數字 user id；真正的 user id 在 `id` claim。Mini App（initData）用的是 `id`，所以 web OIDC 也必須以 `id` 當 `providerUid`，否則同一個人會被建成兩個 identity / 兩個 user。我們的 `profile()` 因此回傳 `id: String(profile.id)`。

**id_token 簽章演算法**（Discovery `id_token_signing_alg_values_supported`）：`RS256`、`ES256`、`EdDSA`、`ES256K`。

---

## 安全驗證步驟（文件要求）

1. 從 JWKS endpoint 取得公鑰
2. 用公鑰**驗證 JWT 簽章**
3. 驗證 claims：
   - `iss` 必須等於 `https://oauth.telegram.org`
   - `aud` 必須等於自己的 Bot ID
   - `exp` 未過期

---

## 踩雷點（與標準 OIDC 的差異）

這三點正是我們實作時連續撞到的錯誤，記錄下來避免重蹈覆轍：

### 1. `state` 太長 → `state too long`

Telegram 對 `state` 參數有 **~128 字元上限**，但 Auth.js 預設產生的是 JWE 加密 state，長達 400+ 字元。
→ **解法：** 移除 `state` check，只留 `pkce`。PKCE（RFC 7636）本身已提供等效的 CSRF 防護。

### 2. 沒有 UserInfo endpoint → `Authorization server did not provide a userinfo endpoint`

Auth.js 的 `type: "oidc"` provider 會跑 discovery，且在 discovery doc 缺 `userinfo_endpoint` 時直接 throw（`@auth/core` callback.ts）。Telegram 的 discovery doc 沒有這個欄位。
→ **解法：** 改用 `type: "oauth"`。oauth 分支會改呼叫 `userinfo.request()`，讓我們從 id_token 自行取得 claims。

### 3. `InvalidEndpoints: missing both issuer and userinfo`

`type: "oauth"` 在沒有 `issuer` 時，Auth.js 的 config assertion 會要求 `authorization` / `token` / `userinfo` 三者都有 `url`。我們的 `userinfo` 只有 `request`、沒有 `url`。
→ **解法：** 補上 `issuer`，assertion 那段就會整段跳過；同時因為 `token` 有 URL，callback 仍走「手動分支」而非 discovery，`userinfo.request()` 照樣被呼叫。

### 4. （瀏覽器端）COOP header

文件提醒：若網站送出 `Cross-Origin-Opener-Policy: same-origin`，會擋住 Telegram 登入 library。需改用 `same-origin-allow-popups` 或移除該 header。

---

## 我們的實作對應

[`src/auth.ts`](../src/auth.ts) 的 `TelegramOIDC` provider：

```ts
type: "oauth",                       // 踩雷點 2：避開 OIDC discovery
issuer: "https://oauth.telegram.org",// 踩雷點 3：通過 endpoint assertion
authorization: { url: ".../auth", params: { scope: "openid profile" } },
token: ".../token",                  // 有 URL → callback 走手動分支
checks: ["pkce"],                    // 踩雷點 1：丟掉 state
userinfo: {
  // 沒有 UserInfo endpoint → 從 id_token 取 claims，並用 JWKS 驗簽
  request: ({ tokens }) =>
    jwtVerify(tokens.id_token, telegramJwks, {
      issuer: "https://oauth.telegram.org",
      audience: process.env.AUTH_TELEGRAM_CLIENT_ID,
    }).then((r) => r.payload),
},
profile: (p) => ({ id: String(p.id) /* 用 id 而非 sub，對齊 Mini App */, ... }),
```

環境變數：`AUTH_TELEGRAM_CLIENT_ID`、`AUTH_TELEGRAM_CLIENT_SECRET`。
