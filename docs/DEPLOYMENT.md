# 部署 Deployment（GitHub → Vercel + 自訂網域）

正式環境:**Vercel**(前端 + Bot webhook + API)+ **Neon Postgres** + **Telegram BotFather**,對外用**自訂網域**。
前提:Neon DB、Vercel 帳號、Telegram bot、自訂網域都已擁有。程式碼已 push 到 GitHub。

> 下文以 `splitbill.example.com` 代表你的自訂網域,實際操作時換成你的。
> 只有你能做的外部步驟用 **🧑 手動** 標記;其餘是本機指令。

**為什麼先綁網域**:`NEXT_PUBLIC_MINI_APP_URL` 是 build 時就編進前端的,webhook 與 BotFather 也都要填網址。
先把自訂網域綁好,所有網址一次就填自訂網域,**就不用為了換掉 `*.vercel.app` 再 redeploy / 重設一輪**。

---

## 步驟總覽

1. 🧑 Vercel 匯入 GitHub repo(先別 Deploy)
2. 🧑 在 Vercel 綁定自訂網域 + 設 DNS
3. 🧑 設環境變數(網址用自訂網域)
4. 🧑 Deploy
5. 本機把 schema 推到 Neon(`pnpm db:push`)
6. 本機設 Telegram webhook 指向自訂網域
7. 🧑 BotFather 把 Mini App URL 改成自訂網域
8. 驗證

---

## 1. 🧑 Vercel 匯入專案

Vercel Dashboard → **Add New… → Project** → 選這個 GitHub repo → Import。
Framework 會自動偵測為 **Next.js**,設定用預設即可,**先別按 Deploy**,先做步驟 2、3。

## 2. 🧑 綁定自訂網域 + DNS

Project → **Settings → Domains** → 輸入 `splitbill.example.com` → Add。
Vercel 會給你 DNS 設定值,到你的網域註冊商 / DNS 服務商加上:

- 子網域(如 `splitbill.example.com`):加一筆 **CNAME** → `cname.vercel-dns.com`
- 根網域(如 `example.com`):依 Vercel 指示加 **A record**(通常 `76.76.21.21`)

加完等 DNS 生效,Vercel 會自動簽發 TLS 憑證(Telegram 要求 HTTPS,這步必成)。
Domains 頁顯示 **Valid Configuration** 才算完成。

## 3. 🧑 設環境變數

Project → **Settings → Environment Variables**,以下五個都加(Environment 勾 **Production** 與 **Preview**):

| Key | 值 | 備註 |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather 給的 token | |
| `TELEGRAM_WEBHOOK_SECRET` | 自訂的強隨機字串 | **要記下來**,步驟 6 本機要用同一個值 |
| `TELEGRAM_MINI_APP_NAME` | BotFather 的 app short name(例:`splitbill`) | |
| `DATABASE_URL` | Neon **Pooled** 連線字串 + `?sslmode=require` | 用 pooled,不要用 direct |
| `NEXT_PUBLIC_MINI_APP_URL` | `https://splitbill.example.com/mini` | **填自訂網域**,不要填 `*.vercel.app` |

產生 webhook secret 的一個方法:

```bash
openssl rand -hex 32
```

## 4. 🧑 Deploy

按 **Deploy**。完成後,用自訂網域開 `https://splitbill.example.com/mini` 應該看到 Mini App 的瀏覽器預覽畫面(正式啟動要從 Telegram 進)。

## 5. 把 schema 推到 Neon

本機(`.env.local` 內的 `DATABASE_URL` 要指向同一個 Neon DB):

```bash
pnpm db:push
```

把 [`src/db/schema.ts`](../src/db/schema.ts) 的七張表同步到 Neon。本專案不走 migration 檔,直接 push。

## 6. 設 Telegram webhook

本機 `.env.local` 需有 `TELEGRAM_BOT_TOKEN` 與 `TELEGRAM_WEBHOOK_SECRET`,
且 **secret 必須和步驟 3 在 Vercel 設的完全相同**(部署後的 `/api/telegram` 會驗證這個 header,不一致會被擋):

```bash
pnpm bot:set-webhook https://splitbill.example.com
```

腳本會自動接上 `/api/telegram`,設定 `secret_token`、`drop_pending_updates`,並印出 `getWebhookInfo` 供確認。

## 7. 🧑 BotFather 更新 Mini App URL

群組裡開 Mini App 走的是 BotFather 註冊的 direct-link(`t.me/<bot>/<app>`),那個 Web App URL 也要指向自訂網域:

```
@BotFather → /myapps → 選你的 app → Edit Web App URL
  → https://splitbill.example.com/mini
```

(私訊裡的按鈕走 `NEXT_PUBLIC_MINI_APP_URL`,已在步驟 3 設定。)

## 8. 驗證

- 終端機看步驟 6 印出的 `getWebhookInfo`:`url` 是自訂網域、`last_error_message` 應為空。
- 把 bot 拉進一個 Telegram 群組 → `/start` → 點「開啟 Splitbill」→ Mini App 正常載入、看得到資料。
- 試 `/add 100 午餐 @someone` → Mini App 餘額有更新。

---

## 之後的更新

push 到 GitHub 預設分支 → Vercel 自動重新部署。
**網域沒變就不用重設 webhook**;只有換網域 / 換 secret 時才需重跑步驟 6。

## 常見問題

- **Domains 一直不是 Valid**:DNS 還沒生效,或 CNAME/A 設錯。等一下或對照 Vercel 給的值再查一次。
- **webhook 沒反應**:多半是 `TELEGRAM_WEBHOOK_SECRET` 在 Vercel 與本機不一致;或 webhook 還指向舊網址(ngrok / `*.vercel.app`)。重跑步驟 6。
- **Mini App 開啟一片空白 / 只有預覽**:`NEXT_PUBLIC_MINI_APP_URL` 或 BotFather 的 URL 沒指到自訂網域的 `/mini`;改 `NEXT_PUBLIC_*` 後記得 redeploy。
- **DB 連線錯誤**:確認用的是 Neon **pooled** 連線字串且帶 `?sslmode=require`。
