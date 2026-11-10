# 揪帳 Joubill

> English version: [README.md](README.md)

不用離開聊天室就能分帳。把揪帳機器人加進 Telegram 群組，打 `/add 300 午餐`，
它會算出誰欠誰多少，以及讓大家結清所需的最少轉帳次數。沒有 Telegram 的朋友
也能用瀏覽器加入同一本帳。

## 功能

- **一行記帳**：在群組打 `/add 500 晚餐`。金額怎麼寫都行：`1,200`、`$300`、
  `1.5k`、`150+200`。
- **用按鈕調整，不用背語法**：每筆支出都有一張卡片，誰付、誰分、每人份數、
  幣別都在 **⚙️ 調整** 按鈕裡。
- **帳目清楚**：`/balance` 顯示每個人的淨額，`/settle` 建議最少的轉帳方式。
- **多幣別**：每筆可以用不同幣別，依當天匯率或群組約定的匯率換算成群組幣別。
- **彈性分帳**：一筆可以多人共付，分帳可以均分、依份數、指定金額、依比例或
  微調。每筆最多 5 張收據照片。
- **人人都能修正**：任何成員都能編輯或刪除任何紀錄，每次修改都會在聊天室和
  歷史紀錄裡標明是誰改的。
- **沒有帳號的成員**：只填名字就能先加入，對方之後加入時再合併到他的帳號。
- **統計與匯出**：個人花費趨勢、CSV 匯出，以及給個人帳本用的
  [beancount](https://beancount.github.io/) 匯出。

## 開始使用

1. 在 Telegram 找到揪帳機器人，**把它加進要分帳的群組**。它會打招呼並附上
   **開啟揪帳 →** 按鈕（沒有的話打 `/start`）。
2. 記第一筆：`/add 300 午餐`。按卡片上的 **⚙️ 調整** 修改誰付、誰分。
3. 要還錢時用 `/balance` 和 `/settle`。

機器人只看得到指令、`@` 它的訊息和對它的回覆，所以成員是用過機器人之後才會
出現在帳本裡。想馬上加人，就回覆對方的一則訊息再打 `/join`。

## 群組指令

| 指令             | 說明                                   |
| ---------------- | -------------------------------------- |
| `/add`           | 記一筆，例如 `/add 500 晚餐`           |
| `/list`          | 最近 10 筆支出                         |
| `/balance`       | 各人淨額                               |
| `/settle`        | 最少還款建議                           |
| `/export`        | 把全部帳目以 CSV 檔傳到群組            |
| `/join`          | 回覆對方的訊息再打 `/join`，把人加進來 |
| `/link <邀請碼>` | 把網頁建立的群組綁到這個聊天室         |
| `/app`           | 開啟 Mini App                          |
| `/help`          | 指令說明，附完整使用說明的連結         |

與機器人的私訊可以用 `/start` 和 `/help`。

## 兩種入口，同一本帳

- **Mini App**：在 Telegram 裡開啟，用 `/app` 或機器人訊息上的按鈕。
- **網頁版**：在瀏覽器開 `/app`，功能相同。可用 Telegram 登入，網站有開放時
  也能用 GitHub、Google 或 LINE。可以直接在網頁建立群組，用邀請碼邀朋友，
  不需要 Telegram。手機上可以加到主畫面，有人記了跟你有關的帳時會收到通知。

兩邊看到的是同一份資料。完整的使用說明在網站的 `/help`，機器人的 `/help`
回覆裡也有連結。

## Claude Code 外掛

讓 Claude Code 透過 MCP 記帳、查帳。先在 個人設定 → 連結的應用程式 建立個人存取權杖，啟動 Claude Code 時設好環境變數 `SPLITBILL_URL`（你的網址，不含結尾斜線）和 `SPLITBILL_TOKEN`，然後執行：

```
/plugin marketplace add chiachunho/joubill
/plugin install splitbill@splitbill
```

## 自己架一個

揪帳是一個 Next.js 應用程式（bot webhook、Mini App、網頁版和 API），跑在
Vercel 上，資料庫是 Neon Postgres。

- [docs/DEVELOPMENT.zh-TW.md](docs/DEVELOPMENT.zh-TW.md)：本機開發、指令與測試
- [docs/DEPLOYMENT.zh-TW.md](docs/DEPLOYMENT.zh-TW.md)：部署到 Vercel 並綁定自訂網域
- [CLAUDE.md](CLAUDE.md) 和 [docs/architecture/](docs/architecture/)：程式碼怎麼組織、為什麼這樣設計（英文）

## 授權

[MIT](LICENSE)
