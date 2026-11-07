---
name: splitbill
description: Record or look up shared expenses, settlements, balances and receipts in Splitbill (揪帳). Use when the user wants to log who paid for something, split a bill or a receipt, record a repayment, or ask who owes whom.
---

# Splitbill

The `splitbill` MCP server does the work; its own instructions describe the workflow and are sent to you
on connect, so follow those rather than anything repeated here. This skill only says when to reach for it.

Use it when the user:

- logs an expense ("I paid 1,200 for dinner, split with Hua and Jenny") or a repayment;
- asks for a balance, who owes whom, or what was spent in a period;
- shows a receipt: use the `split_receipt` prompt to go item by item, and `attach_receipt` to keep the photo;
- wants to fix or remove a record they or you made.

Always preview a write with `dryRun: true` and wait for the user's yes before saving.

If the tools are missing or answer 401, the connection is not set up: the user needs `SPLITBILL_URL`
(their deployment's address, no trailing slash) and `SPLITBILL_TOKEN` (a personal access token from
Settings > Linked applications) in the environment Claude Code starts in.
