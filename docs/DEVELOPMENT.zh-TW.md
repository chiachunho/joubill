# 開發 Development

> English version: [DEVELOPMENT.md](DEVELOPMENT.md)

一個 Next.js 15 (App Router) 應用程式同時承載 grammY bot webhook、Telegram
Mini App（`/mini`）、瀏覽器網頁版（`/app`）、REST API（`/api`）和使用說明
（`/help`）。程式碼的組織方式請看 [CLAUDE.md](../CLAUDE.md) 和
[architecture/](architecture/)（英文）；正式環境請看
[DEPLOYMENT.zh-TW.md](DEPLOYMENT.zh-TW.md)。

## Stack

- **Frontend / Server**：Next.js 15 (App Router) + React 19，前端資料層用 RTK Query
- **UI**：Tailwind CSS + shadcn/ui
- **Bot**：grammY（webhook 模式）
- **DB**：Neon Serverless Postgres + Drizzle ORM
- **驗證**：Zod
- **Web 登入**：Auth.js (NextAuth v5)：Telegram OAuth，可選 GitHub / Google / LINE
- **測試**：Vitest、Playwright（對已部署的 preview 跑 E2E）
- **部署**：Vercel

套件管理用 **pnpm**；Node 固定在 24.x（`.nvmrc`）。

## 開發前置

1. 跟 [@BotFather](https://t.me/BotFather) 建立 Telegram Bot，拿到 `TELEGRAM_BOT_TOKEN`。
2. 註冊 direct-link Mini App（讓群組裡也能開啟）：
   ```
   @BotFather → /newapp → 選你的 bot
     - Title: Splitbill
     - Description: 群組分帳
     - Photo: 任意 640x360
     - Web App URL: https://<你的對外網址>/mini
       (本機開發用 tunnel 網址；之後可用 /editapp 改)
     - Short name: joubill  ← 這個填到 TELEGRAM_MINI_APP_NAME
   ```
3. （選填，Web 登入用）BotFather → Bot Settings → Web Login → 記下 Client ID / Secret。
4. 在 [neon.tech](https://neon.tech) 建立專案，拿 `DATABASE_URL`（pooled，`?sslmode=require`）。
5. 複製環境變數並填入（清單見 `.env.example`，各變數說明見
   [DEPLOYMENT.zh-TW.md](DEPLOYMENT.zh-TW.md)）：
   ```bash
   cp .env.example .env.local
   ```

## 本機執行

```bash
pnpm install
pnpm db:migrate        # 套用 migrations/ 裡的資料遷移
pnpm db:push           # 把 schema 同步到 Neon
pnpm dev               # http://localhost:3000
```

Telegram webhook 需要 https，用 tunnel 把開發伺服器對外：

```bash
cloudflared tunnel --url http://localhost:3000
```

接著把 bot 指過去，並註冊指令選單：

```bash
pnpm bot:set-webhook https://<你的 tunnel 網址>
```

```bash
pnpm bot:set-commands
```

`bot:set-webhook` 會自動接上 `/api/telegram`、用 `TELEGRAM_WEBHOOK_SECRET` 設定
`secret_token`，並印出 `getWebhookInfo`。把 bot 加進 Telegram 群組並輸入 `/start`。
Mini App 只能在 Telegram 裡用，瀏覽器直接開 `/mini` 只會看到預覽，請改用 `/app`。

## 檢查

```bash
pnpm typecheck
```

```bash
pnpm lint
```

```bash
pnpm format:check
```

```bash
pnpm test
```

E2E 是對已部署的網站跑，不是本機伺服器（`pnpm e2e`，需要 `E2E_BASE_URL` 和
`E2E_DATABASE_URL`）；CI 會在每個 Vercel preview 上跑。詳見
[CLAUDE.md](../CLAUDE.md) 的 "Testing"。

## 貢獻

PR 請開到 `dev`。commit 標題和 PR 標題用 Conventional Commits（`feat(bot): …`），
PR 描述要寫明對應的 issue（`Closes #N`、`Part of #N` 或 `No-issue`）。
