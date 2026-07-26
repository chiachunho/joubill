# Deployment (GitHub → Vercel + custom domain)

> 中文版：[DEPLOYMENT.zh-TW.md](DEPLOYMENT.zh-TW.md)

Production runs on **Vercel** (frontend + bot webhook + API) + **Neon Postgres**
+ **Telegram BotFather**, served from a **custom domain**.
Assumes you already own: a Neon DB, a Vercel account, a Telegram bot, and a
custom domain. The code is already pushed to GitHub.

> Below, `splitbill.example.com` stands for your custom domain — substitute your own.
> External steps only you can do are marked **🧑 manual**; the rest are local commands.

**Why bind the domain first**: `NEXT_PUBLIC_MINI_APP_URL` is compiled into the
frontend at build time, and the webhook + BotFather also need the URL. Binding
the custom domain first means every URL is filled in once with the final domain
— no extra redeploy / re-setup round just to replace a `*.vercel.app` URL.

---

## Overview

1. 🧑 Import the GitHub repo into Vercel (don't Deploy yet)
2. 🧑 Bind the custom domain + set DNS
3. 🧑 Set environment variables (use the custom domain in URLs)
4. 🧑 Configure Web Login in BotFather (get OIDC credentials + set Redirect URI)
5. 🧑 Deploy
6. Push the schema to Neon (`pnpm db:push`)
7. Backfill existing users into `auth_identities` (`pnpm db:migrate-identities`, **one-time**)
8. Set the Telegram webhook to the custom domain
9. 🧑 Point the BotFather Mini App URL at the custom domain
10. Verify

---

## 1. 🧑 Import the project into Vercel

Vercel Dashboard → **Add New… → Project** → pick this GitHub repo → Import.
The framework is auto-detected as **Next.js**; the defaults are fine. **Don't
hit Deploy yet** — do steps 2, 3, 4 first.

## 2. 🧑 Bind the custom domain + DNS

Project → **Settings → Domains** → enter `splitbill.example.com` → Add.
Vercel gives you DNS values; add them at your registrar / DNS provider:

- Subdomain (e.g. `splitbill.example.com`): add a **CNAME** → `cname.vercel-dns.com`
- Apex domain (e.g. `example.com`): add the **A record** Vercel shows (usually `76.76.21.21`)

Wait for DNS to propagate; Vercel auto-issues a TLS certificate (Telegram
requires HTTPS, so this step must succeed). The Domains page should read
**Valid Configuration** when done.

## 3. 🧑 Set environment variables

Project → **Settings → Environment Variables**. Add all of the following (tick
both **Production** and **Preview**):

### Required

| Key | Value | Notes |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | the token from BotFather | |
| `TELEGRAM_WEBHOOK_SECRET` | a strong random string | **write it down** — step 8 needs the same value locally |
| `TELEGRAM_MINI_APP_NAME` | the BotFather app short name (e.g. `splitbill`) | |
| `TELEGRAM_STORAGE_CHAT_ID` | the private channel's chat_id (negative number) | see below |
| `DATABASE_URL` | Neon **Pooled** connection string + `?sslmode=require` | use pooled, not direct |
| `NEXT_PUBLIC_MINI_APP_URL` | `https://splitbill.example.com/mini` | **use the custom domain**, not `*.vercel.app` |
| `AUTH_SECRET` | random string | signs Auth.js sessions; `openssl rand -base64 32` |
| `AUTH_TELEGRAM_CLIENT_ID` | BotFather Web Login Client ID | from step 4 |
| `AUTH_TELEGRAM_CLIENT_SECRET` | BotFather Web Login Client Secret | from step 4 |

#### Create the receipt storage channel

Receipt photos live on Telegram's own servers; the bot needs a private channel
as a store:

1. In Telegram, create a **private channel** (any name, e.g. "SplitBill Storage").
2. Add the bot to the channel as an **Admin**, with only the "Post Messages" permission.
3. Get the channel `chat_id` (a large negative number like `-1001234567890`):
   - Send a message to the channel, then forward it to `@userinfobot`; it replies `Forwarded from chat #XXXXXXXXXX`.
   - Or via the Bot API: send a message, then read `channel_post.chat.id` from `https://api.telegram.org/bot<TOKEN>/getUpdates`.
4. Put that `chat_id` into `TELEGRAM_STORAGE_CHAT_ID`.

### Optional (GitHub / Google web login)

| Key | Value |
| --- | --- |
| `AUTH_GITHUB_ID` | GitHub OAuth App Client ID |
| `AUTH_GITHUB_SECRET` | GitHub OAuth App Client Secret |
| `AUTH_GOOGLE_ID` | Google OAuth Client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth Client Secret |

If these four are unset, the login page shows only the Telegram button. The
GitHub / Google OAuth App Callback URLs are:
- `https://splitbill.example.com/api/auth/callback/github`
- `https://splitbill.example.com/api/auth/callback/google`

Generate random strings with:

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -hex 32      # TELEGRAM_WEBHOOK_SECRET
```

## 4. 🧑 Configure Web Login in BotFather

Telegram OIDC needs OIDC credentials from BotFather plus a registered Redirect URI:

```
@BotFather → /mybots → pick your bot → Bot Settings → Web Login
  → note the Client ID and Client Secret (fill into step 3's env vars)
  → add Redirect URI: https://splitbill.example.com/api/auth/callback/telegram
```

> ⚠️ The Redirect URI must match exactly (including https, path, no trailing slash), or Telegram rejects the OIDC callback.

## 5. 🧑 Deploy

Hit **Deploy**. When it finishes, opening `https://splitbill.example.com/mini`
on the custom domain should show the Mini App's browser preview (real launch is
from inside Telegram).

## 6. Push the schema to Neon

Locally (your `.env.local` `DATABASE_URL` must point at the same Neon DB):

```bash
pnpm db:push
```

This syncs the twelve tables in [`src/db/schema.ts`](../src/db/schema.ts) to
Neon. This project uses no migration files — it pushes directly.

## 7. Backfill auth_identities (one-time)

**A brand-new deployment can skip this step** (no old data to migrate).

If you're upgrading from an older version (users already have `telegramId` in
the `users` table), backfill their Telegram identities into the new
`auth_identities` table:

```bash
pnpm db:migrate-identities
```

The script copies each `users.telegramId` into one
`auth_identities(provider='telegram', providerUid=telegramId)` row. It's safe to
re-run (`ON CONFLICT DO NOTHING`).

## 8. Set the Telegram webhook

Your local `.env.local` needs `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`,
and the **secret must be identical to the one set in Vercel in step 3** (the
deployed `/api/telegram` validates this header and rejects mismatches):

```bash
pnpm bot:set-webhook https://splitbill.example.com
```

The script appends `/api/telegram`, sets `secret_token`,
`drop_pending_updates` and `allowed_updates`, and prints `getWebhookInfo` to
confirm.

`allowed_updates` includes **`chat_member`**, which is not in Telegram's default
update set — it only arrives because it is listed explicitly, and only while the
bot is a **group administrator**. It is what tracks members who join via invite
link. Without it (or without admin rights) the bot silently falls back to the
narrower `new_chat_members` service message; nothing breaks, some joins just go
unrecorded. **Changing the `allowed_updates` list requires re-running this step**
— it is stored server-side by Telegram, not read from the deploy.

Admin rights are optional but buy one more thing: `getChatMember` is only
guaranteed to answer correctly about *other* people while the bot is an
administrator, and a non-admin bot can report `left` for someone who really is a
member. `/join` and `/add` therefore only enforce their "is this person actually
in the chat" check when the bot is an admin (`canVerifyMembership` in
`src/bot/membership.ts`); otherwise they trust the sender. Promoting the bot
makes that check real, so a mistyped or forwarded mention can't seat an outsider
in the ledger.

## 9. 🧑 Update the Mini App URL in BotFather

Opening the Mini App inside a group uses the BotFather-registered direct-link
(`t.me/<bot>/<app>`); that Web App URL must also point at the custom domain:

```
@BotFather → /myapps → pick your app → Edit Web App URL
  → https://splitbill.example.com/mini
```

(The button in private chats uses `NEXT_PUBLIC_MINI_APP_URL`, already set in step 3.)

## 10. Verify

**Mini App (inside Telegram)**
- Check the `getWebhookInfo` printed in step 8: `url` is the custom domain, `last_error_message` should be empty.
- Add the bot to a Telegram group → `/start` → tap "Open Splitbill" → the Mini App loads and shows data.
- Try `/add 100 lunch @someone` → the Mini App balance updates.
- Try sending a photo with the caption `/add 50 receipt test` → the bot replies with the expense message.
- Tap the "Upload receipt" button after `/add` → the bot sends a ForceReply → reply with a photo → the bot replies 👍.
- Edit an expense in the Mini App → tap "Attach receipt photo" → pick an image → see the thumbnail (means upload + proxy work).

**Web login**
- Open `https://splitbill.example.com/login` → see the "Sign in with Telegram" button.
- Tap it → redirect to Telegram OAuth → authorize → redirect back to `/app` → see the group list.
- Tap a group → balances and the expense list render.

---

## Subsequent updates

Push to the default branch on GitHub → Vercel auto-redeploys.
**If the domain hasn't changed you don't need to re-set the webhook** — only
re-run step 8 when the domain, the secret, or the `allowed_updates` list changes.

## Troubleshooting

- **Domains never goes Valid**: DNS hasn't propagated, or the CNAME/A record is wrong. Wait, or re-check against the values Vercel showed.
- **Webhook unresponsive**: usually `TELEGRAM_WEBHOOK_SECRET` differs between Vercel and local; or the webhook still points at an old URL (ngrok / `*.vercel.app`). Re-run step 8.
- **Mini App opens blank / preview only**: `NEXT_PUBLIC_MINI_APP_URL` or the BotFather URL doesn't point at the custom domain's `/mini`; remember to redeploy after changing `NEXT_PUBLIC_*`.
- **DB connection errors**: confirm you're using the Neon **pooled** connection string with `?sslmode=require`.
- **Telegram login button missing / OIDC fails**: confirm `AUTH_TELEGRAM_CLIENT_ID` / `AUTH_TELEGRAM_CLIENT_SECRET` are set and the BotFather Web Login Redirect URI matches `https://<domain>/api/auth/callback/telegram` exactly.
- **GitHub / Google login fails**: `AUTH_GITHUB_*` / `AUTH_GOOGLE_*` unset, or the OAuth App Callback URL wasn't added.
- **Receipt upload fails (502)**: `TELEGRAM_STORAGE_CHAT_ID` is wrong, or the bot isn't an Admin / lacks "Post Messages" in that channel.
- **Mini App shows a blank receipt image**: `TELEGRAM_STORAGE_CHAT_ID` is correct but the `/api/tg-photo` proxy failed; check Vercel Function logs for a `getFile` error.
