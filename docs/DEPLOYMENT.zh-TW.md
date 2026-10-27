# 部署 Deployment（GitHub → Vercel + 自訂網域）

> English version: [DEPLOYMENT.md](DEPLOYMENT.md)

正式環境:**Vercel**(前端 + Bot webhook + API)+ **Neon Postgres** + **Telegram BotFather**,對外用**自訂網域**。
前提:Neon DB、Vercel 帳號、Telegram bot、自訂網域都已擁有。程式碼已 push 到 GitHub。

> 下文以 `splitbill.example.com` 代表你的自訂網域,實際操作時換成你的。
> 只有你能做的外部步驟用 **🧑 手動** 標記;其餘是本機指令。

**為什麼先綁網域**:`NEXT_PUBLIC_MINI_APP_URL` 是 build 時就編進前端的,webhook 與 BotFather 也都要填網址。
先把自訂網域綁好,所有網址一次就填自訂網域,**就不用為了換掉 `*.vercel.app` 再 redeploy / 重設一輪**。

---

## 步驟總覽

1. 🧑 Vercel 匯入 GitHub repo（先別 Deploy）
2. 🧑 在 Vercel 綁定自訂網域 + 設 DNS
3. 🧑 設環境變數（網址用自訂網域）
4. 🧑 BotFather 設定 Web Login（取得 OIDC 憑證 + 設 Redirect URI）
5. 🧑 Deploy
6. 本機把 schema 推到 Neon（`pnpm db:push`）
7. 本機把現有使用者身分填入 `auth_identities`（`pnpm db:migrate-identities`，**一次性**）
8. 本機設 Telegram webhook 指向自訂網域
9. 🧑 BotFather 把 Mini App URL 改成自訂網域
10. 驗證

---

## 1. 🧑 Vercel 匯入專案

Vercel Dashboard → **Add New… → Project** → 選這個 GitHub repo → Import。
Framework 會自動偵測為 **Next.js**,設定用預設即可,**先別按 Deploy**,先做步驟 2、3、4。

## 2. 🧑 綁定自訂網域 + DNS

Project → **Settings → Domains** → 輸入 `splitbill.example.com` → Add。
Vercel 會給你 DNS 設定值,到你的網域註冊商 / DNS 服務商加上:

- 子網域（如 `splitbill.example.com`）:加一筆 **CNAME** → `cname.vercel-dns.com`
- 根網域（如 `example.com`）:依 Vercel 指示加 **A record**（通常 `76.76.21.21`）

加完等 DNS 生效,Vercel 會自動簽發 TLS 憑證（Telegram 要求 HTTPS,這步必成）。
Domains 頁顯示 **Valid Configuration** 才算完成。

## 3. 🧑 設環境變數

Project → **Settings → Environment Variables**,以下所有變數都加（Environment 勾 **Production** 與 **Preview**）:

### 必填

| Key                           | 值                                            | 備註                                                    |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`          | BotFather 給的 token                          |                                                         |
| `TELEGRAM_WEBHOOK_SECRET`     | 自訂的強隨機字串                              | **要記下來**,步驟 8 本機要用同一個值                    |
| `TELEGRAM_MINI_APP_NAME`      | BotFather 的 app short name（例:`splitbill`） |                                                         |
| `TELEGRAM_STORAGE_CHAT_ID`    | 私有頻道的 chat_id（負數）                    | 見下方說明                                              |
| `DATABASE_URL`                | Neon **Pooled** 連線字串 + `?sslmode=require` | 用 pooled,不要用 direct                                 |
| `NEXT_PUBLIC_MINI_APP_URL`    | `https://splitbill.example.com/mini`          | **填自訂網域**,不要填 `*.vercel.app`                    |
| `AUTH_SECRET`                 | 隨機字串                                      | Auth.js 簽署 session 用。`openssl rand -base64 32` 生成 |
| `AUTH_TELEGRAM_CLIENT_ID`     | BotFather Web Login 的 Client ID              | 步驟 4 取得                                             |
| `AUTH_TELEGRAM_CLIENT_SECRET` | BotFather Web Login 的 Client Secret          | 步驟 4 取得                                             |

#### 建立 Receipt Storage Channel

收據照片存在 Telegram 自己的伺服器,bot 需要一個私有頻道當倉庫:

1. 在 Telegram 建立一個**私有頻道**（名稱隨意,例如「SplitBill Storage」）
2. 將 bot 加進頻道,設為 **Admin**,只需勾選 "Post Messages" 權限
3. 取得頻道的 `chat_id`（大負數,格式如 `-1001234567890`）:
   - 傳一則訊息到頻道,然後 forward 給 `@userinfobot`,它會回覆 `Forwarded from chat #XXXXXXXXXX`
   - 或用 Bot API:`https://api.telegram.org/bot<TOKEN>/getUpdates` 傳訊息後看 `channel_post.chat.id`
4. 把取得的 `chat_id` 填入 `TELEGRAM_STORAGE_CHAT_ID`

### 選填（GitHub / Google OAuth 登入）

| Key                  | 值                             |
| -------------------- | ------------------------------ |
| `AUTH_GITHUB_ID`     | GitHub OAuth App Client ID     |
| `AUTH_GITHUB_SECRET` | GitHub OAuth App Client Secret |
| `AUTH_GOOGLE_ID`     | Google OAuth Client ID         |
| `AUTH_GOOGLE_SECRET` | Google OAuth Client Secret     |

沒設這四個則登入頁只顯示 Telegram 登入按鈕。GitHub / Google OAuth App 的 Callback URL 填:

- `https://splitbill.example.com/api/auth/callback/github`
- `https://splitbill.example.com/api/auth/callback/google`

產生隨機字串的方法:

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -hex 32      # TELEGRAM_WEBHOOK_SECRET
```

## 4. 🧑 BotFather 設定 Web Login

Telegram OIDC 需要在 BotFather 取得 OIDC 憑證,並註冊 Redirect URI:

```
@BotFather → /mybots → 選你的 bot → Bot Settings → Web Login
  → 記下 Client ID 與 Client Secret（填入步驟 3 的環境變數）
  → 新增 Redirect URI: https://splitbill.example.com/api/auth/callback/telegram
```

> ⚠️ Redirect URI 必須完全吻合（含 https、路徑、無結尾斜線）,否則 OIDC 回呼會被 Telegram 拒絕。

## 5. 🧑 Deploy

按 **Deploy**。完成後,用自訂網域開 `https://splitbill.example.com/mini` 應該看到 Mini App 的瀏覽器預覽畫面（正式啟動要從 Telegram 進）。

## 6. 把 schema 推到 Neon

本機（`.env.local` 內的 `DATABASE_URL` 要指向同一個 Neon DB）:

```bash
pnpm db:push
```

把 [`src/db/schema.ts`](../src/db/schema.ts) 的十二張表同步到 Neon。本專案不走 migration 檔,直接 push。

## 7. 填充 auth_identities（一次性）

**全新部署可跳過此步驟**（沒有舊資料要遷移）。

若是從舊版升級（`users` 表裡已有 `telegramId` 的使用者），需要把他們的 Telegram 身分填入新的 `auth_identities` 表:

```bash
pnpm db:migrate-identities
```

腳本會把每個 `users.telegramId` 複製成一筆 `auth_identities(provider='telegram', providerUid=telegramId)`。可安全重複執行（`ON CONFLICT DO NOTHING`）。

## 8. 設 Telegram webhook

本機 `.env.local` 需有 `TELEGRAM_BOT_TOKEN` 與 `TELEGRAM_WEBHOOK_SECRET`,
且 **secret 必須和步驟 3 在 Vercel 設的完全相同**（部署後的 `/api/telegram` 會驗證這個 header,不一致會被擋）:

```bash
pnpm bot:set-webhook https://splitbill.example.com
```

腳本會自動接上 `/api/telegram`,設定 `secret_token`、`drop_pending_updates`,並印出 `getWebhookInfo` 供確認。

## 9. 🧑 BotFather 更新 Mini App URL

群組裡開 Mini App 走的是 BotFather 註冊的 direct-link（`t.me/<bot>/<app>`）,那個 Web App URL 也要指向自訂網域:

```
@BotFather → /myapps → 選你的 app → Edit Web App URL
  → https://splitbill.example.com/mini
```

（私訊裡的按鈕走 `NEXT_PUBLIC_MINI_APP_URL`,已在步驟 3 設定。）

## 10. 驗證

**Mini App（Telegram 內）**

- 終端機看步驟 8 印出的 `getWebhookInfo`:`url` 是自訂網域、`last_error_message` 應為空。
- 把 bot 拉進一個 Telegram 群組 → `/start` → 點「開啟 Splitbill」→ Mini App 正常載入、看得到資料。
- 試 `/add 100 午餐 @someone` → Mini App 餘額有更新。
- 試傳一張照片並在 caption 輸入 `/add 50 收據測試` → bot 回覆支出訊息。
- 點 `/add` 後的「上傳收據」按鈕 → bot 發 ForceReply → 回覆並附照片 → bot 回 👍。
- Mini App 編輯支出 → 點「附上收據照片」→ 選圖 → 看到縮圖（代表上傳成功且 proxy 正常）。

**Web 登入**

- 開 `https://splitbill.example.com/login` → 看到「使用 Telegram 登入」按鈕。
- 點按鈕 → 跳到 Telegram OAuth → 授權 → 跳回 `/app` → 看到群組列表。
- 點一個群組 → 餘額、支出列表正常顯示。

---

## 之後的更新

push 到 GitHub 預設分支 → Vercel 自動重新部署。
**網域沒變就不用重設 webhook**;只有換網域 / 換 secret 時才需重跑步驟 8。

## 常見問題

- **Domains 一直不是 Valid**:DNS 還沒生效,或 CNAME/A 設錯。等一下或對照 Vercel 給的值再查一次。
- **webhook 沒反應**:多半是 `TELEGRAM_WEBHOOK_SECRET` 在 Vercel 與本機不一致;或 webhook 還指向舊網址（ngrok / `*.vercel.app`）。重跑步驟 8。
- **Mini App 開啟一片空白 / 只有預覽**:`NEXT_PUBLIC_MINI_APP_URL` 或 BotFather 的 URL 沒指到自訂網域的 `/mini`;改 `NEXT_PUBLIC_*` 後記得 redeploy。
- **DB 連線錯誤**:確認用的是 Neon **pooled** 連線字串且帶 `?sslmode=require`。
- **Telegram 登入按鈕沒出現 / OIDC 失敗**:確認 `AUTH_TELEGRAM_CLIENT_ID`、`AUTH_TELEGRAM_CLIENT_SECRET` 已設定,且 BotFather Web Login 的 Redirect URI 完全吻合 `https://<domain>/api/auth/callback/telegram`。
- **GitHub / Google 登入失敗**:`AUTH_GITHUB_*` / `AUTH_GOOGLE_*` 未設定,或 OAuth App 的 Callback URL 沒加。
- **收據照片上傳失敗（502）**:`TELEGRAM_STORAGE_CHAT_ID` 設錯,或 bot 不是該頻道的 Admin / 沒有 "Post Messages" 權限。
- **Mini App 顯示收據圖片空白**:`TELEGRAM_STORAGE_CHAT_ID` 正確但 `/api/tg-photo` proxy 失敗;查 Vercel Function logs 確認 `getFile` 是否有錯。
