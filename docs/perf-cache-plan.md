# Mini App 效能 / 快取改善計畫

> 目標:讓 Mini App 頁面間切換「即時」,消除每次切頁的「載入中…」全屏空白。
> 預期實作者:Claude Sonnet（新 session）。本文件為完整交接。

## 問題診斷（現況）

所有 `/mini/**` 頁面都是 client component，資料在 `useEffect` mount 後才 fetch，於是每次切頁：

1. 先 render「載入中…」全屏空白
2. `tmaFetch` 每次 `await import("@twa-dev/sdk")`（重複動態載入）
3. 打 1～3 個 `force-dynamic` Node API route → Neon HTTP
4. **沒有任何 client 端快取** → `group → edit → 返回 group` 每次都重抓
5. group page 同時抓 `expenses` + `balance` + `settle`，而 `settle` 跟 `balance` 在 server **各自跑一次 `computeGroupBalances`**（重複運算 + 重複 FX 查詢）

核心解法：**SWR（stale-while-revalidate）client 快取** + 砍掉重複的 server 工作。

---

## 技術選型

- **SWR**（`swr`，~4kb）而非 TanStack Query：Mini App 跑在行動 webview，bundle 要小；API 也較簡單。
- 不需要改 server 成 RSC/streaming（authed + initData 在 client 才拿得到，維持 client fetch 模式）。

---

## 變更清單（建議實作順序）

### 1. 安裝 SWR
```
pnpm add swr
```

### 2. `tmaFetch` 只 import SDK 一次 + 讀 initData 一次
檔案：`src/lib/tma-fetch.ts`

- 加 module 層 memo：第一次呼叫 `await import("@twa-dev/sdk")` 後把 `WebApp.initData` 字串快取在 `let cachedInitData`，之後直接用，不再 import / 不再 await。
- 匯出一個給 SWR 用的 `tmaFetcher = (path: string) => tmaFetch(path)`。

注意：initData 在一個 session 內不變，快取安全。

### 3. 全域 SWRConfig（mini layout）
檔案：新增 `src/components/mini/SWRProvider.tsx`（client），在 `src/app/mini/layout.tsx` 包住 children。

設定建議：
```ts
<SWRConfig value={{
  fetcher: tmaFetcher,
  revalidateOnFocus: false,   // Telegram webview focus 事件很吵，關掉
  keepPreviousData: true,     // 切頁時保留舊資料 → 不閃空白
  dedupingInterval: 5000,
}}>
```

### 4. 把 `minimizeTransfers` 拆成「純」模組（關鍵）
目前 `src/lib/settlement.ts` **頂部 import 了 `@/db`**，所以 client 不能直接 import 它（會把 neon/drizzle 打包進 client 或直接爆）。

- 新增 `src/lib/settlement-core.ts`：放 `NetBalance` / `Transfer` 型別 + `minimizeTransfers`（純函式，零 import db）。
- `src/lib/settlement.ts` 改成 `export * from "./settlement-core"` 並只保留 `computeGroupBalances`（碰 db 的部分）。
- `src/lib/__tests__/settlement.test.ts` 的 import 改指向 `settlement-core`（測試內容不變）。

這樣 client 可以直接 `import { minimizeTransfers } from "@/lib/settlement-core"`。

### 5. group page：砍掉 `/settle` fetch，client 端算
檔案：`src/app/mini/groups/[id]/page.tsx`

- 改用 `useSWR` 抓 `expenses` 和 `balance`（兩個 key）。
- **移除對 `/api/groups/[id]/settle` 的 fetch**：直接用 `balance` 回傳的 `balances`（已含 profiles）丟給 `minimizeTransfers` 在 client 算出 transfers。少一個 round trip + 不再重複 `computeGroupBalances`。
- settle 確認（mark as paid）成功後改用 SWR 的 `mutate` 重新驗證 `balance` + `expenses`（取代現在的 `refetch()`）。`useOptimistic` 的部分可保留或改用 SWR optimistic `mutate`（二選一，建議統一用 SWR `mutate` 的 optimisticData）。

> 註：`/api/groups/[id]/settle` route 可保留（bot `/settle` 指令仍用 server 版 `computeGroupBalances`+`minimizeTransfers`），只是 Mini App 不再呼叫它。

### 6. 其他頁面改用 useSWR
- `src/app/mini/page.tsx` → `useSWR("/api/me/groups")`
- `src/app/mini/groups/[id]/expenses/new/page.tsx` → `useSWR("/api/me/groups")` + `useSWR("/api/groups/[id]/members")`
- `.../[expenseId]/edit/page.tsx` → 上述兩個 + `useSWR(expense detail)`
- `src/app/mini/groups/[id]/stats/page.tsx` → `useSWR("/api/groups/[id]/stats")`

因為有 `keepPreviousData`，這些頁面被重訪時會**先秀快取、背景再 revalidate**，視覺上即時。

### 7. mutation 後做快取失效（取代 router.refresh 全抓）
檔案：`src/components/mini/ExpenseForm.tsx`

- add / edit / delete 成功後，用 SWR global `mutate`（可用 key 前綴比對）讓 `expenses` / `balance` / `stats` 失效，再 `router.push` 回 group page。回到 group page 時 SWR 會用新資料。
- 可加 optimistic：刪除時先 `mutate` 把該筆從 expenses cache 拿掉。

### 8. server 端小優化（次要，可選）
檔案：`src/lib/settlement.ts` 的 `computeGroupBalances` + `src/lib/fx.ts`

- `computeGroupBalances` 內目前對每一筆 leg 都 `await getRate(...)` 序列執行。先收集 distinct `(currency, day)` 配對、一次解析成 rate map，再 map 計算 → 減少 await 串接。
- 同幣別（base==quote）已在 `getRate` 短路回 1、不查 DB，所以**單一幣別群組本來就快**；此優化主要對混幣群組有感。

### 9.（可選）skeleton 取代「載入中…」
有了 `keepPreviousData` 後切頁已不太閃；首次載入仍可用簡單 skeleton 卡片提升質感。非必要。

---

## 不做 / 排除

- **不**改成 RSC / server fetch：initData 只能在 client 拿。
- **不**加 CDN / route segment cache：路由是 per-user authed dynamic，不能公開快取。
- **不**引入 MTProto 或其他重架構。

---

## 驗證方式

1. `pnpm dev` + ngrok，從 Telegram 開 Mini App。
2. `group → 點某筆 expense edit → BackButton 返回 group`：返回應**即時顯示**（不閃「載入中…」），背景靜默 revalidate。
3. DevTools Network：重訪頁面應看到 SWR dedup（短時間內不重打）、`/settle` 不再被 Mini App 呼叫。
4. 新增 / 刪除一筆 expense → 回 group page → 餘額與明細已更新（mutate 生效）。
5. `pnpm typecheck` + `pnpm test` 綠（settlement 測試改 import 後仍過）。
6. 確認 client bundle 沒把 `@/db` / drizzle / neon 打包進去（settlement-core 拆分正確）：可看 build 輸出或 `next build` 無 server-only 警告。

---

## 受影響檔案總表

新增：
- `src/components/mini/SWRProvider.tsx`
- `src/lib/settlement-core.ts`

修改：
- `src/lib/tma-fetch.ts`（memo SDK/initData，匯出 fetcher）
- `src/lib/settlement.ts`（拆出 core、re-export）
- `src/app/mini/layout.tsx`（包 SWRProvider）
- `src/app/mini/page.tsx`
- `src/app/mini/groups/[id]/page.tsx`（useSWR + 移除 settle fetch + client 端 minimizeTransfers + mutate）
- `src/app/mini/groups/[id]/stats/page.tsx`
- `src/app/mini/groups/[id]/expenses/new/page.tsx`
- `src/app/mini/groups/[id]/expenses/[expenseId]/edit/page.tsx`
- `src/components/mini/ExpenseForm.tsx`（mutation 後 mutate）
- `src/lib/__tests__/settlement.test.ts`（import 改 settlement-core）
- `package.json`（+swr）
