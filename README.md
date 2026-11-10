# 揪帳 Joubill

> 中文版：[README.zh-TW.md](README.zh-TW.md)

Split group expenses without leaving the chat. Add the 揪帳 bot to a Telegram
group, type `/add 300 lunch`, and it works out who owes whom and the fewest
transfers that settle everyone up. Friends without Telegram can use the same
ledger from a browser.

## What it does

- **One-line expenses**: `/add 500 dinner` in the group chat. Amounts can be
  written loosely: `1,200`, `$300`, `1.5k`, `150+200`.
- **Fix it with buttons, not syntax**: every expense gets a card with a
  **⚙️ 調整** button for who paid, who splits, shares per person and currency.
- **Clear balances**: `/balance` shows each person's net amount, and `/settle`
  suggests the fewest transfers that clear the group.
- **Many currencies**: each record can be in a different currency. Balances are
  converted to the group's currency at that day's rate, or at a rate the group
  agrees on.
- **Flexible splits**: several people can pay for one expense, and the cost can
  be split equally, by shares, by exact amounts, by percentage or with
  adjustments. Up to 5 receipt photos per expense.
- **Everyone can fix mistakes**: any member can edit or delete any record. Each
  change shows who made it in the chat and in the activity history.
- **Members without an account**: add someone by name only and merge them into
  their real account if they join later.
- **Stats and exports**: per-person spending trends, CSV export, and a personal
  [beancount](https://beancount.github.io/) export for your own ledger.

## Getting started

1. Find the 揪帳 bot in Telegram and **add it to the group** you want to split
   expenses in. It greets the group with an **開啟揪帳 →** button (type
   `/start` if it doesn't).
2. Record the first expense: `/add 300 lunch`. Tap **⚙️ 調整** on the card to
   change who paid or who splits.
3. Use `/balance` and `/settle` when it's time to pay each other back.

The bot only sees commands, @mentions of it and replies to it, so people show up
in the ledger as they use the bot. To add someone right away, reply to one of
their messages and type `/join`.

## Commands (in a group)

| Command        | What it does                                              |
| -------------- | --------------------------------------------------------- |
| `/add`         | Record an expense, e.g. `/add 500 dinner`                 |
| `/list`        | The 10 most recent expenses                               |
| `/balance`     | Each person's net amount                                  |
| `/settle`      | The fewest transfers that settle everyone up              |
| `/export`      | Post every record as a CSV file                           |
| `/join`        | Reply to someone's message, then type `/join` to add them |
| `/link <code>` | Bind a group created on the web to this chat              |
| `/app`         | Open the Mini App                                         |
| `/help`        | Command help, with a link to the full guide               |

In a private chat with the bot, `/start` and `/help` work.

## Two ways in, one ledger

- **Mini App**: opens inside Telegram, from `/app` or any button on the bot's
  messages.
- **Web App**: the same features in a browser at `/app`. Sign in with Telegram,
  or with GitHub, Google or LINE where the site enables them. You can create a
  group on the web and invite friends with an invite code, with no Telegram
  needed. On a phone you can add it to the home screen and get notified when
  someone records something that involves you.

Both show the same data. The full user guide (in Traditional Chinese) is at
`/help` on the site, and the bot's `/help` reply links to it.

## Claude Code plugin

Let Claude Code record and check expenses over MCP. Create a personal access token under
Settings > Linked applications, then start Claude Code with `SPLITBILL_URL` (your deployment, no
trailing slash) and `SPLITBILL_TOKEN` set, and run:

```
/plugin marketplace add chiachunho/splitbill-telegram-bot
/plugin install splitbill@splitbill
```

## Running your own instance

揪帳 is one Next.js app (bot webhook, Mini App, Web App and API) on Vercel with a
Neon Postgres database.

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): local setup, scripts and tests
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): deploying to Vercel with a custom
  domain
- [CLAUDE.md](CLAUDE.md) and [docs/architecture/](docs/architecture/): how the
  code is organised and why

## License

[MIT](LICENSE)
