# Discord 支援設計（繁體中文）

> 狀態：**草案，尚未實作**。本文件整理「讓揪帳同時支援 Discord server bot」的設計方向、
> 需要改動的地方與分階段計畫。標註 ⚠️ **待確認** 的項目是尚未對照 Discord 最新官方文件驗證的假設，
> 動工前需先確認。

---

## 目標與非目標

**目標**

- Discord 伺服器的頻道可以像 Telegram 群組一樣記帳：`/add`、`/balance`、`/settle`、`/list`、`/join`，以及每筆紀錄一則可編輯的卡片訊息。
- 沿用既有的結算、匯率、稽核、REST API 與 Web App，不另起一套後端。
- Discord 使用者可以登入 Web App（`/app/**`）。

**非目標（至少第一階段）**

- 同一本帳橫跨 Telegram 與 Discord。一個群組只屬於一個平台。
- Discord Activity（Discord 版 Mini App），見[附錄 A](#附錄-adiscord-activity)。
- 帳號綁定與合併，見[附錄 B](#附錄-b跨平台帳號綁定)。記帳正確性不依賴它。

---

## 現況盤點

### 可直接沿用（與平台無關）

| 模組 | 說明 |
|---|---|
| `src/lib/settlement-core.ts` / `settlement.ts` | 結算演算法只用 DB 和數學 |
| `src/lib/fx.ts`、`rate-lock.ts` | 匯率優先順序與平台無關 |
| `src/lib/parseAdd.ts` | `/add` 的寬鬆解析在 Discord 照樣適用 |
| `src/lib/record-audit.ts`、`record-history.ts` | 稽核紀錄的 diff 和快照 |
| `/api/**` REST、`/app/**` Web App | 已經用 Auth.js session cookie 登入，不依賴 `initData` |
| `auth_identities` | 本來就是多 provider 設計，Discord 只是多一個 `provider='discord'` |

### 綁定 Telegram，需要改

- **Schema（`src/db/schema.ts`）**
  - `groups.telegramChatId` 是 `NOT NULL UNIQUE`，等於假設群組一定是 Telegram 聊天室。
  - `expenses.notice_message_id`、`group_delete_requests.telegramMessageId` 都假設是 Telegram 的 message id。
  - `receipt_awaiting` / `add_awaiting` 的 `chat_id` 也是 Telegram 專用。這兩張表在 Discord 端由 Modal 取代，可以維持 Telegram 專用。
- **Discord id（snowflake）是 64-bit，會超過 2^53。** 現有的 `bigint(..., { mode: "number" })` 存進去會失去精度，Discord 的 id 一律要用 `text` 或 bigint `mode: "string"`。這是整件事最容易踩到的坑。
- **訊息同步**：`src/lib/notify.ts` 和 `src/lib/record-mutation.ts` 直接吃 grammy 的 `Api`。`renderCard`（`src/bot/expenseCard.ts`）輸出的是 Telegram HTML 加 `InlineKeyboard`。`src/bot` 以外有 6 個檔案 import `grammy`。
- **收據照片**：存成 Telegram 儲存頻道的 `file_id`。Discord 附件的網址有簽章而且會過期，不能直接存網址。
- **頭像**：`/api/me/groups/photos`、`/api/groups/[id]/avatars` 直接呼叫 Telegram API。

---

## Telegram → Discord 概念對照

| Telegram | Discord | 設計影響 |
|---|---|---|
| Webhook `POST /api/telegram` | Interactions Endpoint `POST /api/discord/interactions` | 用 HTTP 模式，可以跑在 Vercel serverless，不需要一直連著 Gateway。每個請求都要用 Ed25519 驗簽（`DISCORD_PUBLIC_KEY`）。 |
| 群組聊天室 | Guild + **channel**（或 thread） | **一個 channel = 一個群組**。guild 太粗，一個 server 常有好幾群互不相干的人。 |
| `/add 300 晚餐 @A` | Slash command `/add amount:<string> description:<string> who:<...>` | `amount` 保留字串型別再交給 `parseAdd`，讓 `150+200`、`1,200` 都還能用。文法不擴充，原則與 Telegram 相同。 |
| ForceReply（`add_awaiting`） | **Modal** | 不需要 `add_awaiting` 表，也沒有 `selective` 的問題。 |
| Inline keyboard + `callback_data` | Components（button / select）+ `custom_id` | `guard()` 一樣要檢查紀錄屬於這個群組：`custom_id` 也只是客戶端送來的字串。 |
| `@handle` 無法解析成使用者 | User option 會給完整的 resolved user + member | 解決 CLAUDE.md 裡記錄的 mention 問題。resolved member 本身就能證明對方在 guild 裡，但仍需檢查頻道權限。 |
| 成員只能靠事件累積，無法補齊 | `GET /guilds/{id}/members`（需要 GUILD_MEMBERS privileged intent） | 以 channel 為群組時，還要計算頻道的 view 權限。HTTP 模式只收得到互動事件，`registerUser` 的對應版本只看得到用過 bot 的人。 |
| 回覆無時限 | **3 秒**內必須回應 | 先回 deferred response，之後再更新。長期存在的卡片要用 bot token 的 REST API 編輯，因為 interaction token 15 分鐘後失效。 |
| `disable_notification`（api middleware 統一加） | `SUPPRESS_NOTIFICATIONS` flag | 同樣在 Discord 的送訊息層統一加，不在呼叫端各自設定。 |
| `startapp` deep link | 連結按鈕開 `/app/**` | 第一階段不做 Activity，見附錄 A。 |

---

## 設計

### 1. Schema：群組改為與平台無關

```ts
groups:
  platform         varchar(16)  NOT NULL  -- 'telegram' | 'discord'
  external_chat_id text         NOT NULL  -- Telegram chat id 或 Discord channel id
  UNIQUE(platform, external_chat_id)
  -- 移除 telegram_chat_id

expenses.notice_message_id        → text   -- 平台從 group 判斷
group_delete_requests.telegram_message_id → notice_message_id text
```

- `users` **不加** `discordId` 欄位。Discord 身分只透過 `auth_identities(provider='discord', providerUid=<snowflake 字串>)` 對應。新增 `upsertDiscordUser`，對應現在的 `src/lib/auth/upsertTelegramUser.ts`。
- `chatMigration` 的處理邏輯改為比對 `(platform='telegram', external_chat_id)`。
- 依照專案的 schema 升級慣例：新增 `scripts/migrate-group-platform.ts`，搬資料並在來源欄位已不存在時大聲中止。**必須在 `pnpm db:push` 之前執行**。

### 2. `RecordNotifier`：訊息同步與平台解耦

```ts
interface RecordNotifier {
  send(record: LoadedNotice): Promise<string | null>;   // 回傳 messageId
  update(record: LoadedNotice, messageId: string): Promise<void>;
  markDeleted(record: LoadedNotice, messageId: string, deleter: Deleter): Promise<void>;
}
```

- `record-mutation.ts` 的 `logCreated` / `logUpdated` / `logDeleted` 改收 `notifier`，不再收 grammy 的 `Api`。`notifier: null` 的語意與現在的 `api: null` 相同：呼叫端自己負責訊息，**稽核照寫**。
- 依 `group.platform` 選擇 `TelegramNotifier` 或 `DiscordNotifier`。
- 「審計與群組訊息是同一層、不可拆開」的原則不變。
- 錯誤一律吞掉，原則不變：bot 被踢、訊息被刪，都不能讓 API 請求失敗。

### 3. 卡片渲染：中立模型 + 平台 renderer

```
loadCard() → CardView（文字行、≈ 換算行、×n 權重、按鈕描述）
           ├─ renderTelegram(CardView) → HTML + InlineKeyboard
           └─ renderDiscord(CardView)  → embed + components
```

- 維持「**每種訊息只有一個 renderer**」的原則：同一份 `CardView`，每個平台各翻譯一次，不能出現第二個簡化版 renderer。
- 按鈕文字繼續由 `BTN`（`src/lib/buttons.ts`）提供。
- `formatSettlementNotice`、`formatDeletedNotice`（`src/lib/record-notice.ts`）同樣改成輸出中立結構。

### 4. 按鈕資料格式

`custom_id` 的格式（例如 `del_exp:<id>`、面板模式）與 Telegram 的 `callback_data` 共用同一個模組產生和解析，並寫 round-trip 測試。這和 `src/lib/deep-link.ts` 的理由一樣：產生端和解析端一旦不一致，不會報錯，只會悄悄失效。

### 5. Discord bot（`src/discord/`）

與 `src/bot/` 平行：

- `interactions.ts`：Ed25519 驗簽、PING/PONG、依 interaction type 分派。
- `commands/`：`/add`、`/balance`、`/settle`、`/list`、`/join user:`、`/app`、`/help`。
- `components/`：⚙️ 調整 面板。沿用「無狀態、每次點擊都重新讀 DB 再渲染」的設計，舊卡片照樣能用，同時點擊也會收斂。
- `modals/`：✏️ 金額、💱 其他幣別、空白的 `/add`。
- `/join` 改用 user option：resolved member 證明對方在 guild 裡，再檢查他看不看得到這個頻道。結果一樣有三種：在、不在、無法判斷，**無法判斷時不加入**。
- 回應流程：需要寫 DB 的指令先回 deferred response，處理完再編輯原本的回應，成功後用 bot token 記下卡片的 message id。
- 指令註冊腳本：`scripts/discord-register-commands.ts`，掛在 `pnpm bot:discord-commands`。

### 6. 收據照片

- 第一階段：後端下載 Discord 附件，再用 `sendPhoto` 轉存到現有的 `TELEGRAM_STORAGE_CHAT_ID`，取得 `file_id` 後照常存進 `expense_receipts`。`/api/tg-photo` 不用改。
- 之後如果想完全不依賴 Telegram，再換成 Vercel Blob 或 R2。這也會讓 Telegram 端受益。

### 7. 登入與前端

- `src/auth.ts` 加上 Auth.js 內建的 Discord provider，有設 `AUTH_DISCORD_ID` / `AUTH_DISCORD_SECRET` 才啟用。`profile.id` 就是 snowflake 字串，直接作為 `providerUid`。
- **不要**對 Discord 開 `allowDangerousEmailAccountLinking`。Telegram 使用者沒有 email，開了也幫不上跨平台綁定，反而會多一個用 email 接管帳號的風險面。
- 卡片上的 🔗 App 編輯 在 Discord 端是**連結按鈕**，直接開 `/app/groups/<id>/expenses/<id>`。
- 頭像改用 Discord CDN 的 avatar hash，依平台分流。
- Web App 的群組列表依平台顯示標示。

### 8. 環境變數

| 變數 | 用途 |
|---|---|
| `DISCORD_APP_ID` | Application ID，註冊指令用 |
| `DISCORD_PUBLIC_KEY` | 驗證 interaction 簽章 |
| `DISCORD_BOT_TOKEN` | 呼叫 REST API（送出、編輯訊息，查成員） |
| `AUTH_DISCORD_ID` / `AUTH_DISCORD_SECRET` | Web 登入，選用 |

Discord 的這組變數要做成**選用**：沒設定時 Discord 路由回 404，`serverEnv()` 不能因此丟錯，否則只部署 Telegram 的環境會壞掉。

---

## 分階段計畫

| 階段 | 內容 | 備註 |
|---|---|---|
| **Phase 0** | Schema 去 Telegram 化 + `migrate-group-platform.ts` | 需要資料遷移；不做 Discord 也能先合併 |
| **Phase 1** | `RecordNotifier`、`CardView` 拆層、`custom_id` 模組 | 純重構，讓 `src/lib` 和 API route 不再依賴 grammy |
| **Phase 2** | `src/discord/` bot 本體、指令註冊腳本 | 份量約等於現在的 `src/bot/`（約 2,500 行），但核心邏輯沿用 |
| **Phase 3** | Discord 登入、收據轉存、頭像 | Web App 可供 Discord 使用者使用 |
| **Phase 4** | 文件 | 同步更新 `CLAUDE.md`、`docs/DEPLOYMENT*.md`、`src/app/help/**`（新增頁面並加進 `sections` 陣列） |
| 之後 | 帳號綁定（附錄 B）、Discord Activity（附錄 A） | 視使用情況再決定 |

## 已決定事項

1. **一個群組只屬於一個平台**，不做跨平台共用的帳本。
2. **Discord 的群組單位是 channel**，不是 guild。
3. **第一階段不做 Activity**，App 編輯一律用 Web App 連結。

## 待確認

- ⚠️ 以 channel 為群組時，成員範圍要怎麼定義？「看得到這個頻道的人」需要 guild member 列表加權限計算，而且需要 privileged intent。也可以完全不列舉，比照 Telegram：只算用過 bot 的人加上 `/join` 加入的人。
- ⚠️ Thread 要不要當作獨立群組，還是歸到所屬的父頻道？
- ⚠️ Activity 的 deep link（`customId`）實際能帶哪些資料（見附錄 A）。

---

## 附錄 A：Discord Activity

Discord Activity 是 Discord 版的 Mini App：一個網頁 app 嵌在 Discord 用戶端裡的 iframe 執行（桌面、網頁、手機都能開），透過 `@discord/embedded-app-sdk` 與用戶端溝通。開啟方式有三種：App Launcher（🚀）、Entry Point command（`PRIMARY_ENTRY_POINT`），或 bot 回應互動時用 `LAUNCH_ACTIVITY`。最後一種可以對應卡片上的按鈕。

| | Telegram Mini App | Discord Activity |
|---|---|---|
| 網址 | 直接載入我們的網域 `/mini` | 經由代理 `https://<app_id>.discordsays.com`，在 Developer Portal 設定 URL Mapping 對應到我們的網域 |
| 對外連線 | 沒有限制 | 嚴格的 CSP，只能連 URL Mapping 設定過的網址 |
| 身分驗證 | `initData` HMAC，不需額外 API 呼叫 | `authorize()` 拿到 code → 後端換 token → `authenticate()` |
| 群組情境 | `start_param` | SDK 直接提供 `channelId` / `guildId` |
| 指定紀錄的 deep link | `startapp=group_x_exp_y` | ⚠️ 待確認：分享連結可帶 `customId`，按鈕啟動能帶的資訊較受限 |
| 外部連結 | `WebApp.openLink` | `sdk.commands.openExternalLink` |
| 主題、返回鍵、震動 | 有 | 沒有，導覽要自己做 |

**套用方式（將來要做時）**

- **驗證**：新增 `Authorization: discord <token>` 驗證路徑。code 換 token 時，順便由後端簽發自己的短期 session token，之後都用它，不要每個請求都打 Discord API。iframe 屬於第三方情境，cookie 行為在各用戶端不一致，**不能依賴 session cookie**。`getAuth` 回傳的 `Auth` 結構不變，group 改由 `channelId` 解析。
- **前端：不要再多一份頁面。** `/mini` 和 `/app` 已經是兩份手動維護的副本，Activity **直接重用 `/app/**`**：讓 `web-fetch.ts` 在有 token 時改帶 header，外部連結改走 SDK。
- `/api/tg-photo` 與頁面同網域，經過 URL Mapping 就不受 CSP 影響。匯率由後端抓取，同樣沒問題。
- 本機開發需要 tunnel（例如 cloudflared）加上 Portal 設定，除錯成本比 Mini App 高。

**結論**：等 Phase 2 上線、確定有人在用之後再做。到時候主要是後端驗證的工作，前端改動很少。

---

## 附錄 B：跨平台帳號綁定

### 現況

- `auth_identities` 支援一個 user 掛多個身分。
- Telegram 的兩條登入路徑（Mini App `initData`、Web OAuth）都以數字 Telegram user id 當 `providerUid`，已經對到同一個 user。
- Auth.js 在**已登入狀態**下再用另一個 provider 登入時，會呼叫 `linkAccount` 把新身分掛到目前的 user 上。
- GitHub 和 Google 開了 `allowDangerousEmailAccountLinking`，可以用 email 自動合併。

### 缺口

1. **沒有 UI 入口**：`OAuthButtons` 只出現在 `/login`，個人設定沒有「連結其他帳號」。
2. **Email 合併幫不了**：Telegram 不提供 email。
3. **衝突會是常態**：Discord bot 會跟 Telegram 的 `registerUser` 一樣，有人一用 bot 就自動建立 user。所以等使用者想綁定時，兩邊通常都已經各自有一個 user。這時 Auth.js 會丟出 `OAuthAccountNotLinked`，**它不會合併兩個已經存在的 user**。

```
user A ← telegram:12345   （用 Telegram bot 時建立）
user B ← discord:9876…    （用 Discord bot 時建立）
```

### 設計

**已連結帳號 UI**（`/mini` 和 `/app` 兩份都要改）

- 列出目前的 identities，並提供「連結 Discord／Telegram」按鈕：已登入狀態下呼叫 `signIn(provider)`。
- API：`GET /api/me/identities`，以及 `DELETE`（解除連結，最後一個身分不能刪）。

**使用者合併**

- 在 Auth.js 的 `signIn` callback 攔截「這個身分已屬於別的 user」的情況。兩邊都已經通過 OAuth 證明是本人，才可以合併。
- 在一個 transaction 裡把 B 的資料全部改指向 A，然後刪掉 B。目前指向 `users.id` 的欄位：

  | 表 | 欄位 | 注意 |
  |---|---|---|
  | `group_members` | `user_id` | 同一個 group 兩邊都有時會主鍵衝突（理論上很少發生） |
  | `expenses` | `created_by` | |
  | `expense_payers` | `payer_id` | `UNIQUE(expense_id, payer_id)` 衝突時要合併金額 |
  | `expense_splits` | `debtor_id` | 同上 |
  | `group_exchange_rates` | `created_by` | |
  | `auth_identities` | `user_id` | |
  | `sessions` | `user_id` | 也可以直接刪掉 B 的 session |
  | `group_delete_requests` | `requested_by` | |
  | `record_audit_log` | `actor_id` | **只改 id，不改寫 `before` / `after` 快照**：快照保留當時的名字，這是設計原則 |
  | `user_beancount_configs` | `user_id`、jsonb `person_accounts` 的 key | 同一個 group 兩邊都有時保留 A 的設定 |

- **把「該改哪些欄位」寫成一份清單，放在 `src/lib/`**，再加一個測試：掃描 schema 裡所有指向 `users.id` 的欄位，確認每一個都在清單裡。這是「漂移時不會大聲失敗」的典型例子：之後新增一張表卻忘了更新清單，結果是資料默默變成孤兒。
- 合併本身寫一筆 audit（`recordType: 'user'`），payload 記錄被併掉的 user id。

### 急不急

不急。一個群組只屬於一個平台，不綁定也完全不影響記帳正確性，只影響 Web App 能不能用一個登入身分同時看到兩邊的群組。但只要做綁定，**合併使用者的流程就是必要的**，只做 `linkAccount` 不夠。
