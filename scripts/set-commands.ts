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
  { command: "add", description: "記一筆（/add 500 晚餐）" },
  { command: "list", description: "最近 10 筆支出" },
  { command: "balance", description: "各人淨額" },
  { command: "settle", description: "最少還款建議" },
  { command: "export", description: "匯出全部帳目（CSV）" },
  { command: "join", description: "把人加進揪帳（回覆對方訊息再打 /join）" },
  { command: "link", description: "把網頁建立的群組綁到這個聊天室（/link 邀請碼）" },
  { command: "unlink", description: "解除這個聊天室與 App 的綁定（bot 會離開）" },
  { command: "app", description: "開啟揪帳 Mini App" },
  { command: "help", description: "指令說明" },
];

// Commands available in private chat
const privateCommands = [
  { command: "start", description: "開始使用揪帳" },
  { command: "help", description: "指令說明" },
];

await setCommands(groupCommands, { type: "all_group_chats" });
console.log("set group commands:", groupCommands.map((c) => "/" + c.command).join(", "));

await setCommands(privateCommands, { type: "all_private_chats" });
console.log("set private commands:", privateCommands.map((c) => "/" + c.command).join(", "));
