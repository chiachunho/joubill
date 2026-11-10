# Development

> 中文版：[DEVELOPMENT.zh-TW.md](DEVELOPMENT.zh-TW.md)

One Next.js 15 (App Router) app serves the grammY bot webhook, the Telegram
Mini App (`/mini`), the browser Web App (`/app`), the REST API (`/api`) and the
help site (`/help`). For how the code is organised, read [CLAUDE.md](../CLAUDE.md)
and [architecture/](architecture/). For production, see
[DEPLOYMENT.md](DEPLOYMENT.md).

## Stack

- **Frontend / server**: Next.js 15 (App Router) + React 19, RTK Query on the client
- **UI**: Tailwind CSS + shadcn/ui
- **Bot**: grammY (webhook mode)
- **DB**: Neon Serverless Postgres + Drizzle ORM
- **Validation**: Zod
- **Web login**: Auth.js (NextAuth v5): Telegram OAuth, optional GitHub / Google / LINE
- **Tests**: Vitest, Playwright (E2E against a deployed preview)
- **Deploy**: Vercel

The package manager is **pnpm**; Node is pinned to 24.x (`.nvmrc`).

## Prerequisites

1. Create a Telegram bot with [@BotFather](https://t.me/BotFather) and get the `TELEGRAM_BOT_TOKEN`.
2. Register a direct-link Mini App (so it opens inside groups too):
   ```
   @BotFather → /newapp → pick your bot
     - Title: Splitbill
     - Description: Group expense splitting
     - Photo: any 640x360
     - Web App URL: https://<your-public-url>/mini
       (use a tunnel URL for local dev; change later with /editapp)
     - Short name: joubill  ← this goes into TELEGRAM_MINI_APP_NAME
   ```
3. (Optional, for web login) BotFather → Bot Settings → Web Login → note the Client ID / Secret.
4. Create a Neon project at [neon.tech](https://neon.tech) and get `DATABASE_URL` (pooled connection, `?sslmode=require`).
5. Copy the environment variables and fill them in (`.env.example` lists them all;
   [DEPLOYMENT.md](DEPLOYMENT.md#3--set-environment-variables) explains each one):
   ```bash
   cp .env.example .env.local
   ```

## Run locally

```bash
pnpm install
pnpm db:migrate        # apply data migrations from migrations/
pnpm db:push           # sync the schema to Neon
pnpm dev               # http://localhost:3000
```

Telegram webhooks need HTTPS, so expose the dev server with a tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

Then point the bot at it and register its command menu:

```bash
pnpm bot:set-webhook https://<your-tunnel-host>
```

```bash
pnpm bot:set-commands
```

`bot:set-webhook` appends `/api/telegram`, sets the `secret_token` from
`TELEGRAM_WEBHOOK_SECRET` and prints `getWebhookInfo`. Add the bot to a Telegram
group and send `/start`. The Mini App only works inside Telegram; opening `/mini`
in a browser shows a preview, so use `/app` for the browser.

## Checks

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

E2E runs against a deployed site, not a local server (`pnpm e2e` with
`E2E_BASE_URL` and `E2E_DATABASE_URL`); CI runs it on every Vercel preview. See
"Testing" in [CLAUDE.md](../CLAUDE.md).

## Contributing

Open pull requests against `dev`. Commit subjects and PR titles follow
Conventional Commits (`feat(bot): …`), and the PR description names its issue
(`Closes #N`, `Part of #N` or `No-issue`).
