# Splitbill Telegram Bot

Splitwise 風格的 Telegram 群組分帳 Bot + Mini App。
單一 Next.js (App Router) 同時承載 Mini App 前端、grammY webhook、與資料 API。

## Stack

- **Frontend / Server**：Next.js 15 (App Router) + React 19
- **UI**：Tailwind CSS + shadcn/ui
- **Bot**：grammY (webhook 模式)
- **DB**：Neon Serverless Postgres + Drizzle ORM
- **驗證**：Zod
- **部署**：Vercel (Free)

## 開發前置

1. 建立 Telegram Bot：跟 [@BotFather](https://t.me/BotFather) 申請、拿到 `BOT_TOKEN`。
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
3. 建立 Neon 專案：[neon.tech](https://neon.tech) → 拿 `DATABASE_URL`（建議 pooled，`?sslmode=require`）。
4. 複製環境變數：
   ```bash
   cp .env.example .env.local
   # 填入 TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET / TELEGRAM_MINI_APP_NAME
   #     / DATABASE_URL / NEXT_PUBLIC_MINI_APP_URL
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
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://abc.ngrok.app/api/telegram",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query"]
  }'
```

驗證：

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

之後在 Telegram 群組裡加入 Bot 並輸入 `/start`。

## 指令

- `/start`：在當前群組註冊自己 + 群組
- `/help`：指令說明
- `/add <金額> <說明> @user1 @user2 ...`：新增支出（均分）
- `/list`：列出最近支出
- `/balance`：顯示目前餘額
- `/settle`：產生最少筆數的還款建議
- 開啟 Mini App：使用 `/start` 回覆訊息裡的按鈕

## Mini App

`/mini` 路由是 Telegram Mini App 的進入點，必須透過 Bot 的 `web_app` 按鈕進入（會帶 `initData`），瀏覽器直接打開只能看到預覽。

## 結構

```
src/
├── app/
│   ├── api/telegram/route.ts     # grammY webhook
│   ├── api/groups/[id]/...       # Mini App 用 API
│   ├── mini/                     # Mini App 頁面
│   ├── layout.tsx
│   └── page.tsx                  # 公開 landing
├── bot/
│   ├── index.ts                  # Bot 實例
│   ├── commands/                 # /start, /add, /balance, ...
│   └── middleware/               # 自動註冊
├── components/ui/                # shadcn 元件
├── db/
│   ├── index.ts                  # Drizzle client
│   └── schema.ts                 # 7 張表
└── lib/
    ├── env.ts                    # typed env
    ├── utils.ts                  # cn()
    ├── initData.ts               # Telegram Mini App HMAC 驗證
    ├── settlement.ts             # greedy 最少筆數演算法
    ├── fx.ts                     # 匯率快取
    └── zod.ts                    # 輸入 schema
```

## 部署

Vercel：

1. Push 到 GitHub，Vercel 連專案。
2. Env：把 `.env.local` 的內容貼到 Vercel Project Settings → Environment Variables。
3. 部署後，重新設一次 webhook 指向 Vercel domain。
