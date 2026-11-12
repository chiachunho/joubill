---
name: joubill
description: Record or look up shared expenses, settlements, balances and receipts in Splitbill (揪帳). Use when the user wants to log who paid for something, split a bill or a receipt, record a repayment, or ask who owes whom.
---

# Splitbill

The `joubill` MCP server does the work; its own instructions describe the workflow and are sent to you
on connect, so follow those rather than anything repeated here. This skill only says when to reach for it.

Use it when the user:

- logs an expense ("I paid 1,200 for dinner, split with Hua and Jenny") or a repayment;
- asks for a balance, who owes whom, or what was spent in a period;
- shows a receipt: use the `split_receipt` prompt to go item by item. Don't send the photo yourself by default:
  record the expense, then give the user the `uploadUrl` from the result so they upload the original in the app.
  Send `images` (or `attach_receipt` for an expense that already exists) only when you have the original file
  itself, never a cropped, shrunk or grayscale copy;
- wants to fix or remove a record they or you made.

Always preview a write with `dryRun: true` and wait for the user's yes before saving.

If the tools are missing or answer 401, the connection is not set up: the user needs `SPLITBILL_URL`
(their deployment's address, no trailing slash) and `SPLITBILL_TOKEN` (a personal access token from
Settings > Linked applications) in the environment Claude Code starts in.
