# Splitbill Telegram Bot

> 中文版：[README.zh-TW.md](README.zh-TW.md)

A Splitwise-style group expense-splitting Telegram Bot + Mini App. A single
Next.js (App Router) app serves the Mini App frontend, a standalone web
frontend, the grammY webhook, and the data API at once.

## Stack

- **Frontend / Server**: Next.js 15 (App Router) + React 19
- **UI**: Tailwind CSS + shadcn/ui
- **Bot**: grammY (webhook mode)
- **DB**: Neon Serverless Postgres + Drizzle ORM
- **Validation**: Zod
- **Web login**: Auth.js (NextAuth v5) — Telegram OAuth, optional GitHub / Google
- **Deploy**: Vercel

## Prerequisites

1. Create a Telegram Bot: register with [@BotFather](https://t.me/BotFather) and get the `TELEGRAM_BOT_TOKEN`.
2. Register a direct-link Mini App (so it opens inside groups too):
   ```
   @BotFather → /newapp → pick your bot
     - Title: Splitbill
     - Description: Group expense splitting
     - Photo: any 640x360
     - Web App URL: https://<your-public-url>/mini
       (use an ngrok URL for local dev; change later with /editapp)
     - Short name: splitbill  ← this goes into TELEGRAM_MINI_APP_NAME
   ```
3. (Optional, for web login) BotFather → Bot Settings → Web Login → note the Client ID / Secret.
4. Create a Neon project: [neon.tech](https://neon.tech) → get `DATABASE_URL` (use the pooled connection + `?sslmode=require`).
5. Copy the environment variables:
   ```bash
   cp .env.example .env.local
   # fill in the values — see .env.example for the full list
   ```

## Local development

```bash
pnpm install
pnpm db:push           # sync the schema to Neon
pnpm dev               # http://localhost:3000
```

### Exposing to Telegram

Telegram webhooks require HTTPS; for local dev use ngrok / cloudflared:

```bash
# either one
ngrok http 3000
cloudflared tunnel --url http://localhost:3000
```

### Setting the webhook

Once you have a public URL (e.g. `https://abc.ngrok.app`):

```bash
pnpm bot:set-webhook https://abc.ngrok.app
```

The script appends `/api/telegram`, sets the `secret_token` from
`TELEGRAM_WEBHOOK_SECRET`, and prints `getWebhookInfo` to confirm.

Then add the bot to a Telegram group and send `/start`.

## Commands

- `/start` — register yourself + the group in the current chat
- `/help` — command reference
- `/add <amount> <description> @user1 @user2 ...` — add an expense (split evenly)
- `/list` — list recent expenses
- `/balance` — show current balances
- `/settle` — produce the minimum-transfer repayment plan
- `/link` — get a magic link that opens this group in the web app
- Open the Mini App: use the button in the `/start` reply

## Two entry points

- **Mini App** (`/mini`) — opens inside Telegram via the bot's `web_app` button (carries `initData`). Opening it directly in a browser only shows a preview.
- **Web App** (`/app`, sign in at `/login`) — a standalone browser app for users without Telegram, authenticated with an Auth.js session cookie. Magic links (`/g/<token>`) drop a logged-in user straight into a group.

## Structure

```
src/
├── app/
│   ├── api/telegram/route.ts     # grammY webhook
│   ├── api/auth/...              # Auth.js handlers (web login)
│   ├── api/groups/[id]/...       # REST API (shared by both frontends)
│   ├── api/me/groups/...         # current user's groups
│   ├── api/tg-photo, tg-upload   # receipt-photo proxy + upload
│   ├── mini/                     # Mini App pages (Telegram)
│   ├── app/                      # Web App pages (browser)
│   ├── login/, g/[token]/        # web login + magic-link entry
│   ├── layout.tsx
│   └── page.tsx                  # public landing
├── auth.ts                       # Auth.js config (Telegram / GitHub / Google)
├── bot/
│   ├── index.ts                  # lazy bot singleton
│   ├── commands/                 # /start, /add, /balance, ...
│   └── middleware/               # auto-registration
├── components/                   # shadcn ui + mini/web components
├── db/
│   ├── index.ts                  # Drizzle client
│   └── schema.ts                 # 12 tables
└── lib/
    ├── env.ts                    # typed env
    ├── auth/                     # initData HMAC, sessions, magic links, route guard
    ├── settlement-core.ts        # pure greedy min-transfer algorithm
    ├── settlement.ts             # DB-backed balance queries
    ├── fx.ts                     # exchange-rate cache
    └── zod.ts                    # input schemas
```

## Deployment

Production runs on Vercel (frontend + bot webhook + API in one deploy) behind a
custom domain, backed by Neon Postgres. Full step-by-step in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
