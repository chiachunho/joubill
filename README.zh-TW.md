# Splitbill Telegram Bot（繁體中文）

> English version: [README.md](README.md)

Splitwise 風格的 Telegram 群組分帳 Bot + Mini App。
單一 Next.js (App Router) 同時承載 Mini App 前端、一般 Web 前端、grammY webhook、與資料 API。

## Stack

- **Frontend / Server**：Next.js 15 (App Router) + React 19
- **UI**：Tailwind CSS + shadcn/ui
- **Bot**：grammY (webhook 模式)
- **DB**：Neon Serverless Postgres + Drizzle ORM
- **驗證**：Zod
- **Web 登入**：Auth.js (NextAuth v5) — Telegram OAuth，可選 GitHub / Google
- **部署**：Vercel

## 開發前置

1. 建立 Telegram Bot：跟 [@BotFather](https://t.me/BotFather) 申請、拿到 `TELEGRAM_BOT_TOKEN`。
2. 註冊 direct-link Mini App（讓群組裡也能開啟）：
   ```
   @BotFather → /newapp → 選你的 bot
     - Title: Splitbill
     - Description: 群組分帳
     - Photo: 任意 640x360
     - Web App URL: https://<你的對外網址>/mini
       (本機 dev 用 ngrok URL；之後可用 /editapp 改)
     - Short name: splitbill  ← 這個填到 TELEGRAM_MINI_APP_NAME
   ```
3. （選填，Web 登入用）BotFather → Bot Settings → Web Login → 記下 Client ID / Secret。
4. 建立 Neon 專案：[neon.tech](https://neon.tech) → 拿 `DATABASE_URL`（建議 pooled，`?sslmode=require`）。
5. 複製環境變數：
   ```bash
   cp .env.example .env.local
   # 依 .env.example 的清單填入各變數
   ```

## 本機開發

```bash
pnpm install
pnpm db:push           # 把 schema 同步到 Neon
pnpm dev               # http://localhost:3000
```

### 對外曝光給 Telegram

Telegram webhook 需要 https，本機開發用 ngrok / cloudflared：

```bash
# 任一即可
ngrok http 3000
cloudflared tunnel --url http://localhost:3000
```

### 設定 webhook

拿到對外網址後（例如 `https://abc.ngrok.app`）：

```bash
pnpm bot:set-webhook https://abc.ngrok.app
```

腳本會自動接上 `/api/telegram`、用 `TELEGRAM_WEBHOOK_SECRET` 設定 `secret_token`，
並印出 `getWebhookInfo` 供確認。之後在 Telegram 群組裡加入 Bot 並輸入 `/start`。

## 指令

- `/start`：在當前群組註冊自己 + 群組
- `/help`：指令說明
- `/add <金額> <說明> @user1 @user2 ...`：新增支出（均分）
- `/list`：列出最近支出
- `/balance`：顯示目前餘額
- `/settle`：產生最少筆數的還款建議
- 開啟 Mini App：使用 `/start` 回覆訊息裡的按鈕

## 兩個進入點

- **Mini App**（`/mini`）：透過 Bot 的 `web_app` 按鈕在 Telegram 內開啟（會帶 `initData`）。瀏覽器直接打開只能看到預覽。
- **Web App**（`/app`，登入頁 `/login`）：給沒裝 Telegram 的人用的一般網頁，靠 Auth.js session cookie 驗證。

## 結構

```
src/
├── app/
│   ├── api/telegram/route.ts     # grammY webhook
│   ├── api/auth/...              # Auth.js handlers（Web 登入）
│   ├── api/groups/[id]/...       # REST API（兩個前端共用）
│   ├── api/me/groups/...         # 目前使用者的群組
│   ├── api/tg-photo, tg-upload   # 收據照片 proxy + 上傳
│   ├── mini/                     # Mini App 頁面（Telegram）
│   ├── app/                      # Web App 頁面（瀏覽器）
│   ├── login/                    # Web 登入
│   ├── layout.tsx
│   └── page.tsx                  # 公開 landing
├── auth.ts                       # Auth.js 設定（Telegram / GitHub / Google）
├── bot/
│   ├── index.ts                  # lazy bot 單例
│   ├── commands/                 # /start, /add, /balance, ...
│   └── middleware/               # 自動註冊
├── components/                   # shadcn ui + mini/web 元件
├── db/
│   ├── index.ts                  # Drizzle client
│   └── schema.ts                 # 12 張表
└── lib/
    ├── env.ts                    # typed env
    ├── auth/                     # initData HMAC、session、route guard
    ├── settlement-core.ts        # 純粹的 greedy 最少筆數演算法
    ├── settlement.ts             # 碰 DB 的餘額查詢
    ├── fx.ts                     # 匯率快取
    └── zod.ts                    # 輸入 schema
```

## 部署

正式環境跑在 Vercel（前端 + bot webhook + API 一次部署），對外用自訂網域，
後端是 Neon Postgres。完整步驟見 [docs/DEPLOYMENT.zh-TW.md](docs/DEPLOYMENT.zh-TW.md)。
