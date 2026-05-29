# 部署 Deployment（GitHub → Vercel）

正式環境:**Vercel**(前端 + Bot webhook + API)+ **Neon Postgres** + **Telegram BotFather**。
前提:Neon DB、Vercel 帳號、Telegram bot 都已存在。程式碼已 push 到 GitHub。

> 三個只有你能做的外部步驟用 **🧑 手動** 標記;其餘是本機指令。

---

## 步驟總覽

1. 🧑 Vercel 匯入 GitHub repo
2. 🧑 在 Vercel 設環境變數
3. 🧑 首次 Deploy,拿到正式網域
4. 本機把 schema 推到 Neon(`pnpm db:push`)
5. 本機設 Telegram webhook 指向正式網域
6. 🧑 BotFather 把 Mini App URL 改成正式網域
7. 驗證

---

## 1. 🧑 Vercel 匯入專案

Vercel Dashboard → **Add New… → Project** → 選這個 GitHub repo → Import。
Framework 會自動偵測為 **Next.js**,Build / Output 設定都用預設即可,**先別按 Deploy**,先去設環境變數(下一步)。

## 2. 🧑 設環境變數

Project → **Settings → Environment Variables**,以下五個都加(Environment 勾 **Production** 與 **Preview**):

| Key | 值 | 備註 |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather 給的 token | |
| `TELEGRAM_WEBHOOK_SECRET` | 自訂的強隨機字串 | **要記下來**,步驟 5 本機要用同一個值 |
| `TELEGRAM_MINI_APP_NAME` | BotFather 的 app short name(例:`splitbill`) | |
| `DATABASE_URL` | Neon **Pooled** 連線字串 + `?sslmode=require` | 用 pooled,不要用 direct |
| `NEXT_PUBLIC_MINI_APP_URL` | `https://<你的網域>/mini` | 見下方 ⚠️ |

> ⚠️ **`NEXT_PUBLIC_*` 是 build 時就編進前端的**,改了一定要 redeploy 才生效。
> 如果還不知道正式網域,先用預期值(通常是 `https://<專案名>.vercel.app/mini`);
> 等步驟 3 拿到真正網域後若不一致,回來改這個值並 **Redeploy**。

產生 webhook secret 的一個方法:

```bash
openssl rand -hex 32
```

## 3. 🧑 首次 Deploy

按 **Deploy**。完成後在 Project 首頁可看到正式網域(例:`https://splitbill-xxx.vercel.app`)。
記下這個網域,後面都會用到。若它跟步驟 2 填的 `NEXT_PUBLIC_MINI_APP_URL` 不一致,改掉並 Redeploy。

## 4. 把 schema 推到 Neon

本機(`.env.local` 內的 `DATABASE_URL` 要指向同一個 Neon DB):

```bash
pnpm db:push
```

這會把 [`src/db/schema.ts`](../src/db/schema.ts) 的七張表同步到 Neon。本專案不走 migration 檔,直接 push。

## 5. 設 Telegram webhook

本機 `.env.local` 需有 `TELEGRAM_BOT_TOKEN` 與 `TELEGRAM_WEBHOOK_SECRET`,
且 **secret 必須和步驟 2 在 Vercel 設的完全相同**(部署後的 `/api/telegram` 會驗證這個 header,不一致會被擋掉):

```bash
pnpm bot:set-webhook https://<你的網域>.vercel.app
```

腳本會自動接上 `/api/telegram`,設定 `secret_token`、`drop_pending_updates`,並印出 `getWebhookInfo` 供確認。

## 6. 🧑 BotFather 更新 Mini App URL

群組裡開 Mini App 走的是 BotFather 註冊的 direct-link(`t.me/<bot>/<app>`),
所以那個 Web App URL 也要指向正式環境:

```
@BotFather → /myapps → 選你的 app → Edit Web App URL
  → https://<你的網域>.vercel.app/mini
```

(私訊裡的按鈕走 `NEXT_PUBLIC_MINI_APP_URL`,已在步驟 2 設定。)

## 7. 驗證

- 終端機看步驟 5 印出的 `getWebhookInfo`:`url` 正確、`last_error_message` 應為空。
- 把 bot 拉進一個 Telegram 群組 → `/start` → 點「開啟 Splitbill」→ Mini App 正常載入、看得到資料。
- 試 `/add 100 午餐 @someone` → Mini App 餘額有更新。

---

## 之後的更新

push 到 GitHub 預設分支 → Vercel 自動重新部署。
**網域沒變就不用重設 webhook**;只有換網域 / 換 secret 時才需重跑步驟 5。

## 常見問題

- **webhook 沒反應**:多半是 `TELEGRAM_WEBHOOK_SECRET` 在 Vercel 與本機不一致;或 webhook 還指向舊的 ngrok 網址。重跑步驟 5。
- **Mini App 開啟一片空白 / 預覽畫面**:`NEXT_PUBLIC_MINI_APP_URL` 或 BotFather 的 URL 沒指到正式 `/mini`;改完記得 redeploy(前者)。
- **DB 連線錯誤**:確認用的是 Neon **pooled** 連線字串且帶 `?sslmode=require`。
