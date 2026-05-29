# Web 登入 + 多 Provider 認證 計畫

> 目標:在現有 Telegram Mini App 之外,新增一個**一般 Web 入口**(沒裝 Telegram 也能用)。
> 第一個 web provider = **Telegram Login Widget**,架構要能在未來無痛加上 **GitHub / Google**。
> **硬性前提:不破壞現有 Mini App 路徑**(`Authorization: tma <initData>` 維持原樣)。

現況:[`src/lib/auth/index.ts`](../src/lib/auth/index.ts) 的 `getAuth(req)` 只認 `tma` header,且該檔註解早已預告:「C7 will extend this to also accept a session cookie from the Telegram Login Widget」。本計畫就是 C7 + 之後的 OAuth。

---

## 0. 核心差異:不是技術,是「context 誰幫你帶」

| | Mini App(現況) | Web + Login(要做) |
|---|---|---|
| 識別身分 | initData 一次給齊 | OAuth/widget callback |
| **群組 context** | `start_param` 直接帶 | **沒有** — 登入後要自己選群組 |
| Session | 每次請求重帶 initData | 要 server session(cookie) |
| CSRF | header-based,天生免疫 | cookie-based,**要防** |
| 主題 | 自動套 TG 主題 | 要自己做 light/dark |

→ 因此這計畫有**四個**要解的問題:身分模型、session、群組 context、CSRF。

---

## 1. 身分模型(最關鍵的 schema 變更)

現在 [`users`](../src/db/schema.ts) 的 `telegramId NOT NULL UNIQUE` = 「一個人 = 一個 Telegram id」。要支援 GitHub/Google(可能根本沒有 Telegram),必須改成 **一個 user ↔ 多個 identity**。

**新增 `auth_identities`:**

```
auth_identities
  id            serial pk
  userId        fk -> users.id (cascade)
  provider      'telegram' | 'github' | 'google'
  providerUid   text         -- 該 provider 的使用者 id
  email         text null    -- google/github 給;telegram 沒有
  unique(provider, providerUid)
```

**`users` 調整:**
- `telegramId` 改為 **nullable**(不再是唯一登入路徑;保留欄位給 bot 端方便查詢,或之後完全移到 identities)。
- 新增 `email`(nullable)、`avatarUrl`(nullable)。`firstName` 維持。

**遷移:** 把現有每個 `users.telegramId` 複製成一筆 `auth_identities(provider='telegram', providerUid=telegramId)`。Bot 端的 upsert(`registerUser` / `trackMembership` / `add`)改成「upsert identity → 取得 user」。

> ⚠️ 這層動到所有 bot 寫入點與 `getAuth` 的 user upsert,是整個計畫風險最高、要最先做且要測的部分。

---

## 2. Session 基礎建設

Web 不可能每次都重跑 login widget,需要 server session。

**建議:DB-backed session(可撤銷)**

```
sessions
  id          text pk      -- 隨機 token,放進 cookie
  userId      fk -> users.id (cascade)
  createdAt   timestamptz
  expiresAt   timestamptz
```

- Cookie:`session` = token,旗標 **httpOnly + Secure + SameSite=Lax**,有效期搭配 `expiresAt`。
- 取捨:DB session 比 stateless JWT 多一次查詢,但**能登出 / 撤銷 / 列出裝置**,對分帳這種長期帳號值得。
- (替代:stateless 簽章 cookie,無 DB 但難撤銷。不建議。)

---

## 3. 認證層重構:`getAuth` 變多來源

把 [`getAuth`](../src/lib/auth/index.ts) 改成依序嘗試,**回傳型別不變**(`Auth { user, groupFromParam? }`),所有 API route 不用改:

```
1. Authorization: tma <initData>   → 現行 Mini App 路徑(原封不動)
2. Cookie: session=<token>         → 查 sessions → user
   (都失敗 → UnauthorizedError)
```

新增 `resolveSession(req)`(讀 cookie → 查 session → 回 user)。對 web,`groupFromParam` 通常是 `null`(沒有 start_param),群組改由前端選(見 §5)。

---

## 4. Telegram Login Widget 流程

Widget 回傳 `{ id, first_name, last_name, username, photo_url, auth_date, hash }`。

> 🔑 **驗證演算法跟 initData 不一樣**:Login Widget 的 secret key = `SHA256(bot_token)`;
> Mini App initData 的是 `HMAC_SHA256("WebAppData", bot_token)`(見 [`initData.ts`](../src/lib/auth/initData.ts))。
> 兩者都做 data-check-string + HMAC-SHA256 + constant-time compare + `auth_date` 新鮮度檢查,可共用工具但 **key 來源不同,要分開實作**。

新增:
- 頁面 `/login` — 放 Telegram Login Widget script。
- route `/api/auth/telegram/callback` — 驗證 → upsert user + identity → 建 session → set cookie → redirect 到 `/app`。
- BotFather `/setdomain` 綁定 widget 允許的網域(就是我們的自訂網域)。

---

## 5. 群組 context 解法(你點出的最關鍵問題)

Web 登入只知道「這個 user」,他可能同時在多個分帳群組。三招併用:

1. **Web 首頁 = 選群組**:`/api/me/groups` 已經回傳該 user 的所有群組([me/groups route](../src/app/api/me/groups/route.ts))。Web 首頁直接複用現有 `/mini` 首頁的「我的群組」清單邏輯。
2. **記住最後選的群組**:`activeGroupId` 對 web 改為存「使用者上次選的群組」(cookie 或 user 偏好),回訪直接進。
3. **Magic link 深連結**:bot 產生 `https://<domain>/g/<signed-token>`,token 內含 `groupId`(+ 視需要帶登入)。從 Telegram 點此連結 → 直接進那個群組的 web 頁。等同把 Mini App 的 `start_param` 體驗搬到 web。

---

## 6. 前端結構(Mini App 與 Web 共用)

**同一個 Next app,兩個入口,共用元件**(建議):
- `/mini/**` = Telegram 內嵌(現況)。
- `/app/**` = 一般 web。頁面/元件(餘額、支出、表單、圖表)幾乎完全複用。

要抽象的點:
- **Fetcher**:現在 [`tmaFetch`](../src/lib/tma-fetch.ts) 寫死 `Authorization: tma`。改成
  - Mini App context → 帶 tma header
  - Web context → `credentials: "include"`(靠 cookie),不帶 header
  - 用一個 `AuthProvider` context 偵測環境(`window.Telegram?.WebApp?.initData` 有沒有值)。
- **主題**:Mini App 套 TG 主題([`use-tg-theme.ts`](../src/lib/use-tg-theme.ts));Web 沒有 TG,要自己給 light/dark 預設值(沿用 [design-system](./design-system.md) 的 token,補上 web 的預設 palette)。
- **Back button / haptics**:Mini App 專屬,web 用一般 router 導覽。

---

## 7. 未來 OAuth(GitHub / Google)

**建議導入 [Auth.js (NextAuth v5)](https://authjs.dev) + Drizzle adapter**:
- GitHub / Google = 內建 provider,OAuth dance / CSRF / token 交換都幫你處理。
- Telegram Login Widget 與 Mini App initData = 自訂 **Credentials provider**,內部包我們現有的 verify 函式。
- Auth.js 的 `accounts` / `users` / `sessions` schema 正好對應本計畫的 `auth_identities` / `users` / `sessions` — 一開始就照它的形狀設計,之後接上零摩擦。
- **帳號連結**:已登入者再用另一 provider 登入 → 以 verified email 自動連結,或提供「綁定帳號」UI。

(替代:全手刻 OAuth。完全掌控但 OAuth dance / state / refresh / CSRF 都要自己顧,GitHub/Google 的標準流程不值得手刻 — 不建議。)

---

## 8. 安全清單

- Cookie:`httpOnly` + `Secure` + `SameSite=Lax`。
- **CSRF**:cookie-based 的 `POST/PATCH/DELETE` 要防(`SameSite=Lax` + Origin 檢查,或 double-submit token;用 Auth.js 則內建)。Mini App 走 header 不受影響。
- Session 過期 + rotation;登出能 revoke(DB session 的優勢)。
- Login Widget `auth_date` 新鮮度檢查(對齊 initData 的 `MAX_AGE_SECONDS`)。

---

## 9. 分階段實作

| Phase | 內容 | 風險 |
|---|---|---|
| **0** | 身分模型:`auth_identities` + `sessions` + `users` 欄位 + 資料遷移;改 bot 寫入點 | 高(動現有寫入) |
| **1** | `getAuth` 多來源 + `resolveSession` + fetcher / AuthProvider 抽象 | 中 |
| **2** | `/login` + Telegram Login Widget callback + web 首頁選群組 | 中 |
| **3** | Magic-link 深連結帶群組 context | 低 |
| **4** | Auth.js 導入 + GitHub/Google + 帳號連結 | 中 |

每個 phase 都應可獨立上線且不破壞 Mini App。Phase 0 完成後 Mini App 行為要完全等價(回歸測試重點)。

---

## 10. 決策

**已拍板**(2026-05-29):
1. ✅ **同一個 Next app**:`/mini` + `/app` 兩入口共用元件。
2. ✅ **DB-backed session**:`sessions` 表 + cookie token,可撤銷 / 登出 / 列裝置。
3. ✅ **採 Auth.js (NextAuth v5)**,且 **Phase 0 schema 直接照 Auth.js 形狀設計**(`auth_identities` 對應其 `accounts`),GitHub/Google 之後零摩擦接上,Telegram = 自訂 Credentials provider。

**仍待決定**:
4. **多 provider 自動連結依據:verified email 自動連,還是一律手動綁定？**(可等 Phase 4 再定;在那之前單一 provider 不受影響。)
5. **何時啟動 Phase 0**:現在就動身分模型,還是等 Mini App 功能更穩?(Phase 0 風險最高、會動到所有 bot 寫入點。)
