# UI 文案與邏輯 review（2026-11）

範圍：Mini App / Web App 頁面（`src/components/pages/**`、`src/components/mini/**`、`src/components/pwa/**`）、Help 說明網站（`src/app/help/**`）、MCP 與「連結的應用程式」。Telegram Bot 的回覆不在這次範圍內，只有在 App 或 Help 引用到時才提到。

這份報告只列出問題，沒有改程式。每一項標了等級：

- **P1**：使用者會看到錯的資訊，或照著做會失敗
- **P2**：用詞不一致或說法容易誤解，但不會造成錯誤操作
- **P3**：小地方，有空再改

---

## 一、先決定的事：用詞表

最大的問題是**同一個概念有好幾種叫法**。下面每一列需要你選一個，選定之後才能一次改完。「建議」欄是我的推薦。

| 概念                       | 目前出現的說法                                                                                   | 建議                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 一筆共同花費               | 支出（App 按鈕、表單）、費用（Help、刪除群組文案）、花費（parseAdd）、帳                         | **支出**（App 已經用這個）                                                                                         |
| A 把錢還給 B               | 還款（App）、結算（刪除群組文案）、結清（Help 標題）、轉帳（動態「N 筆轉帳」、群組通知 💸 轉帳） | **還款**；「結清」只用在「所有帳款已結清」這種狀態                                                                 |
| 紀錄（名詞）               | 紀錄、記錄混用（例：尚無支出**記錄**、新增還款**記錄**、留下刪除**記錄**）                       | 名詞一律 **紀錄**，動詞 **記錄**（由 X 記錄）                                                                      |
| 群組的主要貨幣             | 預設貨幣（設定頁、Help）、預設幣別（建立群組頁）                                                 | **預設貨幣**；單筆的欄位仍叫「幣別」                                                                               |
| 分攤的人                   | 參與者（表單）、分攤者（新增成員說明）、分擔者（Help）、誰分（Bot）                              | 表單用 **參與者**，Help 跟著改                                                                                     |
| Telegram bot               | Bot、bot、機器人                                                                                 | 選一個；Help 大多用 **機器人**，App 內偶爾用 bot/Bot                                                               |
| 瀏覽器版本                 | 網頁版（Help、App 內）、Web App（首頁、Help 匯出段落）                                           | **網頁版**                                                                                                         |
| 把群組接到 Telegram 聊天室 | 綁定（Telegram 群組頁、Help）、連結（推播設定「已連結 Telegram」）                               | **綁定**（「連結」已經用在登入方式和連結的應用程式）                                                               |
| 外部 AI 工具的連線         | 連結的應用程式、連線、連接器、權杖                                                               | 清單標題「連結的應用程式」，單一項目叫「連線」，保持現狀即可；但空狀態「還沒有連線」可改成「還沒有連結的應用程式」 |
| 自訂匯率                   | 自訂匯率（UI）、固定匯率（Help multi-currency 第 66 行）                                         | **自訂匯率**                                                                                                       |

群組主頁的三個段落標題目前是英文：`Balance · TWD`、`To Settle`、`Expenses (n)`（`src/components/pages/GroupDetailPage.tsx:290`、`:325`、`:381`），其他頁面的 `.sect` 標題全是中文（成員、關於、通知…）。Help 也得另外翻譯成「Balance（餘額）」「To Settle（待結清）」。**建議改成「餘額」「待還款」「紀錄」**，或決定保留英文並在 design-system 裡寫明。

---

## 二、邏輯問題

### P1

1. **成員列表對自己也顯示刪除鈕，按了只說「刪除失敗，請再試一次」。**
   API 對自己回 400 `cannot remove yourself`（`src/app/api/groups/[id]/members/[userId]/route.ts:98`），UI 卻每一列都有垃圾桶（`src/components/pages/GroupSettings.tsx:202`），錯誤訊息還叫人重試。Help 寫「你不能刪除自己」（group-management 第 113 行）。建議自己那一列不顯示垃圾桶。

2. **「此成員有 N 筆費用記錄」的 N 算錯。**
   `expenseCount = debtorCount + payerCount`（route.ts:116），同一筆裡既付錢又分攤的人（`/add` 記的幾乎都是）會被算兩次，而且還款也算進去。訊息顯示在 `GroupSettings.tsx:99`。建議改成算不重複的 expense id，或文案不寫數字。

3. **刪除成員失敗時，錯誤訊息被確認對話框蓋住。**
   失敗時 `deleteTarget` 不清掉，對話框還開著，錯誤卻顯示在對話框後面的頁面上（`GroupSettings.tsx` 的 `doDelete`）。使用者只看到按鈕轉完沒反應。建議失敗時關掉對話框，或把錯誤放進對話框裡。

4. **網頁建立的群組（沒綁 Telegram）在 Mini App 的匯出頁唯一能按的 CSV 按鈕一定失敗。**
   「匯出 CSV 到群組」（`src/components/pages/GroupExportPage.tsx:86`）不管有沒有聊天室都顯示，API 回「這個群組沒有 Telegram 聊天室」。Mini App 又不能下載。建議沒有聊天室時隱藏這個按鈕並說明要到網頁版下載。

5. **伺服器的英文驗證錯誤會直接顯示在表單上。**
   支出表單的錯誤列用 `apiErrorText`（`src/components/mini/ExpenseForm.tsx:546`），而 API 回的是 zod 的英文 JSON（`src/app/api/groups/[id]/expenses/route.ts:177`）、`users not in group: 12,34`（`src/lib/records/shared.ts:14`）、`expense not found` 等。沒有 body 時則顯示 `HTTP 500`。最常見的觸發情境是表單開著時有人被移出群組。建議前端依 status 對應成中文訊息，英文只留給 log。

### P2

6. **支出表單的平衡提示在「超過」時也說「尚餘」。**
   指定模式用 `Math.abs`，超過總額時顯示「尚餘 50」（`ExpenseForm.tsx:1278`）；比例模式用 `Math.max(0, …)`，超過 100% 時顯示「尚餘 0.00%」（`:1233`）；多人付款則用「差」（`:938`）。建議統一成「還差 X」／「超出 X」。

7. **建立者已不是成員時，「由 X 記錄」整行消失，刪除確認也變回通用文案。**
   `recordedBy` 只在成員清單裡找得到才有值（`ExpenseForm.tsx:204`，SettlementForm 相同）；「最後由…修改」找不到則顯示「?」。兩種處理不一致，而 attribution 正是取代 owner lock 的機制。建議 API 直接回建立者名字，或至少顯示「由 已離開的成員 記錄」。

8. **進入多人付款模式後沒有辦法回到單一付款人。**
   「新增付款人」（`ExpenseForm.tsx:975`）是單向的；只剩一人勾選時仍停在多人介面。

9. **一次選太多張收據，多出來的會被默默丟掉。**
   `files.slice(0, remaining)`（`ExpenseForm.tsx:569`）不會提示。建議顯示「最多 5 張，已略過 N 張」。

10. **時區的用途有三種說法，其中兩種和實際行為不符。**
    實際行為（CLAUDE.md、Help group-management 第 121–126 行）：時區只決定「今天是哪一天」。
    - `TIMEZONE_PURPOSE`（`src/lib/timezone.ts:111`）：「① 決定一筆紀錄算哪一天、查哪一天的匯率」——紀錄的日期是使用者選的，匯率跟著紀錄日期走，都不是時區決定的。
    - `TimezonePrompt`（`src/components/mini/TimezonePrompt.tsx:56`）和時區確認框（`src/components/pages/GroupRatesPage.tsx:176`）各自寫了一段「bot 記帳的日期，以及匯率使用的日期」，沒有用共用常數。
      建議改成一句、放在 `TIMEZONE_PURPOSE`，例如：「時區決定『今天』是哪一天：bot 的 /add 沒指定日期時記在這天。已經記下的紀錄日期不會改變。」

11. **時區有時顯示城市名，有時顯示 IANA 代碼。**
    提示卡的內文用 `describeTimeZone`，按鈕卻是「改成 Asia/Tokyo」（`TimezonePrompt.tsx:61`）；設定頁確認框（`GroupRatesPage.tsx:176`）和動態紀錄（`src/lib/record-audit.ts:381`）也是 IANA 代碼。

12. **「Expenses (n)」的數字含還款，篩選後的空狀態也只說支出。**
    `total` 是所有紀錄（CLAUDE.md 也這樣寫），標題卻叫 Expenses；「只看我的」空狀態寫「沒有與你相關的支出」，但清單裡也有還款。改用「紀錄」可以一起解決。

13. **統計的「誰花得最多」其實是誰付得最多。**
    資料是 `byPayer`（`src/components/pages/GroupStatsPage.tsx:369`），Help 還得特別解釋「不代表她花掉最多」。建議直接改名「誰付得最多」或「誰先墊最多」。

14. **推播說明比實際規則窄。**
    `NotificationSection.tsx:15` 說會通知「別人記了你要分的帳、你收到還款、你記的帳被別人改或刪」。實際規則（`src/lib/push-plan.ts`）是：記錄裡的任何付款人或分攤者都會收到，包括被記為付款人、還款的付款方、你參與（不只是你記的）的紀錄被修改或刪除。建議改成「跟你有關的紀錄被新增、修改或刪除時通知你（你是付款人或要分攤的人）」。

15. **Mini App 在群組頁沒有回到「我的群組」的路。**
    群組頁不呼叫 `useBack`，Telegram 返回鍵不出現；左上角人像（`src/components/pages/platform.mini.tsx:23`）進的是個人設定，再按返回才回群組清單。從 deep link 進來的人找不到建立群組或輸入邀請碼。另外人像在群組清單頁是右上，在群組頁是左上。

16. **待還款卡片的錯誤訊息不會消失。**
    `settleError`（`GroupDetailPage.tsx:177`）只會被設定、不會清除，下一次成功後仍顯示「標記失敗」。

### P3

17. 已轉的流程用了三種說法：按鈕「已轉」、對話框「確認已轉帳」、確認鈕「已完成」（`GroupDetailPage.tsx:368`、`:665`）。建議「標記已還」→「確認 A 已還 B？」→「已還款」。
18. 清單的日期「05 日」帶前導零（`GroupDetailPage.tsx:529`）。
19. 淨額模式寫「墊付 X · 我分 Y」（`GroupDetailPage.tsx:550`），但整個 App 其他地方都用「你」稱呼使用者（`labelUser` 回「你」）。建議「你付 X · 你分 Y」。
20. 還款編輯頁標題下顯示 `#123`（`src/components/mini/SettlementForm.tsx:258`），支出編輯頁沒有。內部 id 對使用者沒有意義，建議拿掉或兩邊都放。
21. 刪除確認文案兩種語氣：別人記的「…刪除後無法復原。」，自己記的「這筆支出將被永久刪除。」（`ExpenseForm.tsx:1360`）。建議統一，並說明群組訊息會留下刪除紀錄。
22. 「啟用中／停用中」是狀態而不是動作，且停用時名字下又寫一次「已停用」（`GroupSettings.tsx:179`）。成員列表沒有說明停用是什麼意思（新支出預設不勾選）。
23. 「設定後，此幣別的所有支出（含過去）都會以這個匯率換算」（`src/components/mini/CustomRatesSection.tsx:249`）漏了還款；下面的對話框又分開數支出和還款。
24. 動態紀錄的匯率鎖定寫「N 筆轉帳」（`record-audit.ts:414`），其他地方都是還款。
25. 使用紀錄頁昨天只顯示「昨天」，沒有時間；今天卻只顯示時間（`McpConnectionCallsPage.tsx:40`）。
26. 使用紀錄頁直接顯示工具代碼（`add_expense`），其他文案都是中文。
27. 首頁空狀態和網站首頁寫「Bot」（`GroupsHome.tsx:97`、`src/app/page.tsx`），首頁按鈕「開啟 Web App」（`src/app/page.tsx:30`）。
28. Telegram 的 General 主題在繁中介面顯示為「一般」，UI 寫死「General」。需要確認你的使用者看到的是哪一個。

---

## 三、Help 和實際畫面不符

### P1

| Help 位置                                           | Help 寫的                                                    | 實際畫面                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| adding-expenses 第 116 行、balances 第 82 行        | 新增支出的按鈕是「＋ 新增」                                  | 按鈕是「＋ 支出」                                                                             |
| adding-expenses 第 197 行、troubleshooting 第 33 行 | 同時刪除會看到「找不到這筆」                                 | 「這筆支出已經不在了，可能剛剛被其他人刪除。」（`deleteErrorMessage`）                        |
| adding-expenses 第 124 行                           | 匯率欄位「下方」標示「市場匯率／群組自訂匯率／此筆自訂匯率」 | 來源寫在欄位的 placeholder 裡，只有「當日市場匯率」「群組自訂匯率」兩種；填了數字後不顯示來源 |
| balances 第 71 行、settlement 第 46、54 行          | 清單裡的還款有 🤝 圖示                                       | 是 lucide 的 HandCoins 圖示（`GroupDetailPage.tsx:498`），不是 emoji                          |
| troubleshooting 第 130 行                           | 「群組設定 → 通知」                                          | 群組設定裡那一列叫「推播這個群組的紀錄」，沒有「通知」區塊                                    |
| mcp 第 123 行                                       | 「你離開某個群組後…」                                        | App 沒有離開群組的功能（不能刪除自己）                                                        |
| adding-expenses 第 164–172 行、settlement 第 21 行  | 每筆紀錄都會在 Telegram 群組有一則訊息                       | 只有綁定了 Telegram 的群組才有；網頁群組沒有                                                  |

### P2

- group-management 第 242 行：「停用…讓他不再出現在新費用裡」，但第 97 行和表單行為都是「仍會出現，只是預設不勾選」。
- web-app 第 91 行列出的個人設定內容（頭像、名稱、關於、登出）已經過時，現在還有登入方式、連結的應用程式、通知、主畫面捷徑。
- getting-started 第 84 行：「左上角人像圖示 → 個人設定」只在 Mini App 的群組頁成立；Mini App 群組清單和網頁版都在右上角（web-app 第 69 行寫右上角）。
- group-management 第 165 行寫「Mini App 和 Web App 都有」，其他地方是網頁版；也沒說網頁群組不能「匯出到群組」。
- multi-currency 第 66 行「固定匯率」→「自訂匯率」。
- 刪除群組相關文案（`DeleteGroupRow`、`DeleteRequestBanner`、Help group-management 第 211 行）寫「費用與結算紀錄」，App 其他地方是「支出與還款」。
- Help 章節名「結清」、「記帳（加入費用）」和 App 用詞不同；選定用詞表後一起改。

### P3

- web-app 第 83 行說網頁版左上角有「返回」連結；支出／還款表單在網頁版是只有箭頭的圖示按鈕，沒有文字。
- troubleshooting 最後一節「聯絡機器人的管理員」沒有聯絡方式，可以改用 `<ContactEmail />`。

---

## 四、MCP 與連結的應用程式

1. **P1**：`forbidden` 的下一步提示叫 agent 告訴使用者到「Settings > Linked applications」（`src/lib/mcp/result.ts:63`），但 App 裡沒有英文介面，實際路徑是「個人設定 → 連結的應用程式」。agent 會照抄這個英文路徑給使用者。建議寫成「個人設定 → 連結的應用程式 (Settings → Linked applications)」。
2. **P2**：instructions 第 9 點（`src/lib/mcp/instructions.ts:18`）和 `delete_record` 的說明說「group chat shows who recorded / deleted it」，網頁群組沒有聊天室；改成「the group's activity log (and its Telegram chat, if linked)」比較準確。
3. **P3**：prompt `split_receipt` 的 title 是中文「拆收據」（`src/lib/mcp/prompts.ts:37`），工具 title 全是英文。看你想讓 client 的選單顯示哪種語言，但應該一致。
4. **P3**：連結的應用程式頁空狀態「還沒有連線」（`LinkedAppsPage.tsx:116`）和段落名「已連結」可以對齊成「還沒有連結的應用程式」。
5. 沒有問題的部分：權限說明（`ACCESS_HINT`）、OAuth 授權頁的「它可以／不能」、撤銷和改權限的確認文案、使用紀錄的結果標籤，都和實際權限一致。

---

## 五、建議的處理順序

1. 先定好第一節的用詞表（需要你決定）。
2. 修第二節 P1 的 5 項邏輯問題，每項都很小，可以一個 PR。
3. 依用詞表一次替換 App 與 Help 的文案，並修第三節 P1 的 Help 錯誤。這一步會動到很多檔案，`pnpm check:page-pairs` 和 Help 要一起更新。
4. 其餘 P2／P3 視時間處理。
