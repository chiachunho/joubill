/**
 * Usage:
 *   pnpm bot:set-commands
 *
 * Calls Telegram setMyCommands to sync the command menu shown in Telegram clients.
 * Run once after initial setup and whenever the command list changes.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error("Missing TELEGRAM_BOT_TOKEN in env.");
  process.exit(1);
}

async function setCommands(commands: { command: string; description: string }[], scope: object) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands, scope }),
  });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) throw new Error(`setMyCommands failed: ${JSON.stringify(json)}`);
}

// Commands available in group chats
const groupCommands = [
  { command: "add", description: "記一筆" },
  { command: "list", description: "最近紀錄" },
  { command: "balance", description: "誰應收、誰應付" },
  { command: "settle", description: "怎麼還最省事" },
  { command: "export", description: "匯出 CSV" },
  { command: "join", description: "回覆某人打 /join 把他加進來" },
  { command: "link", description: "綁定網頁建立的群組" },
  { command: "timezone", description: "群組時區" },
  { command: "topic", description: "通知發到哪個主題" },
  { command: "unlink", description: "解除綁定" },
  { command: "app", description: "開啟揪帳" },
  { command: "help", description: "指令說明" },
];

// Commands available in private chat: the ones that work without a group's chat
// (they ask which group, or answer for all of them).
const privateCommands = [
  { command: "start", description: "開始使用揪帳" },
  { command: "add", description: "記一筆到你的群組" },
  { command: "balance", description: "你在各群組的餘額" },
  { command: "settle", description: "怎麼還最省事" },
  { command: "list", description: "最近紀錄" },
  { command: "export", description: "匯出 CSV 給自己" },
  { command: "app", description: "開啟揪帳" },
  { command: "help", description: "指令說明" },
];

await setCommands(groupCommands, { type: "all_group_chats" });
console.log("set group commands:", groupCommands.map((c) => "/" + c.command).join(", "));

await setCommands(privateCommands, { type: "all_private_chats" });
console.log("set private commands:", privateCommands.map((c) => "/" + c.command).join(", "));
