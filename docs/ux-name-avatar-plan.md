# UX 改善計畫：第一人稱、全名、頭貼

> 預期實作者：Claude Sonnet（新 session）。本文件為完整交接。
> 三個功能可分批 commit，互相依賴關係：A（你）→ B（全名）需一起改；C（頭貼）可獨立。

---

## Feature A：第一人稱「你」

### 問題
所有 `label()` 只輸出第三人稱名字。使用者看到「Jeff 付了 200 TWD」，但那個 Jeff 就是自己，很奇怪。

### 方案
1. group page 加 `useSWR<MeResponse>("/api/me/groups")` 取 `selfUserId`（該 key 在 SWR cache 裡通常已有，不多一次網路）。
2. 把分散各頁面的 `label()` 集中為 `src/lib/label.ts` 共用模組。
3. `labelUser(p, selfUserId?)` — 若 `p.userId === selfUserId` 回傳 `"你"`.

### 新增檔案
#### `src/lib/label.ts`
```ts
type Profile = {
  userId?: number;
  firstName: string | null;
  lastName?: string | null;
  username: string | null;
};

/** Format a display name, optionally replacing the current user with "你". */
export function labelUser(p: Profile | null, selfUserId?: number): string {
  if (!p) return "?";
  if (selfUserId !== undefined && p.userId === selfUserId) return "你";
  const full = [p.firstName, p.lastName].filter(Boolean).join(" ");
  return full || (p.username ? "@" + p.username : "?");
}
```

注意：`userId` 設為 optional，方便只有 `{ firstName, username }` 的地方也能用。

### 修改清單
- `src/app/mini/groups/[id]/page.tsx`
  - 加 `useSWR<MeResponse>("/api/me/groups")` 取 `selfUserId`
  - 刪掉 local `label()`，改 `import { labelUser } from "@/lib/label"`
  - 傳 `selfUserId` 給 `labelUser(...)` 呼叫
  - `BalanceResponse.balances` 的型別元素加 `userId` 欄位（已有）
  - 傳遞 `selfUserId` 的地方：餘額列表、轉帳列表（from/to）、支出明細（payer、splits）
- `src/app/mini/groups/[id]/stats/page.tsx`
  - 刪 local `label()`，改用 `labelUser`（**不**傳 selfUserId，圖表不顯示「你」）
- `src/components/mini/ExpenseForm.tsx`
  - 刪 local `label()`，改用 `labelUser`（**不**傳 selfUserId，下拉選單不用「你」，避免混淆）

---

## Feature B：全名顯示

### 問題
`label()` 目前優先顯示 `@username`，中文名字的人看起來很奇怪。
`lastName` 欄位已在 DB，middleware 也已存入，只是 API routes 沒有 select 它。

### 方案
1. 5 個 API routes 補上 `lastName`。
2. `labelUser()` 改為「全名優先，@username 備用」。
3. ExpenseForm 下拉選單在有 username 時顯示 `「陳大明 (@john)」`，方便同名辨識。

### 修改清單（API routes，只加欄位，不改邏輯）
每個 route 把所有 `users.firstName` / `users.username` 的 select 補上 `users.lastName`，並在回傳 JSON 補 `lastName: ...`。

| Route | 補 lastName 的地方 |
|---|---|
| `src/app/api/groups/[id]/expenses/route.ts` | payer select、debtor select、回傳 payer/splits 物件 |
| `src/app/api/groups/[id]/balance/route.ts` | profileRows select、balances map |
| `src/app/api/groups/[id]/members/route.ts` | rows select |
| `src/app/api/groups/[id]/stats/route.ts` | payerLastName + byPayer map |
| `src/app/api/groups/[id]/settle/route.ts` | profiles select + transfers map（bot /settle 指令還走這個 route）|

### TypeScript 型別更新
每個 Mini App page 的 `Profile` / `Member` type 加 `lastName: string | null`。共同型別建議放在 `label.ts` 裡 export，各 page import 用。

### `labelUser` 邏輯（在 Feature A 的 label.ts 裡）
```ts
const full = [p.firstName, p.lastName].filter(Boolean).join(" ");
return full || (p.username ? "@" + p.username : "?");
```
`firstName` 在 DB 是 `notNull()`，所以幾乎一定有值；`full` 為空的情況很罕見。

### ExpenseForm 下拉選單
```ts
// 付款人 / 參與者 select — 同名可辨認
function labelMember(m: Member): string {
  const full = [m.firstName, m.lastName].filter(Boolean).join(" ");
  if (m.username) return full ? `${full} (@${m.username})` : `@${m.username}`;
  return full || "?";
}
```
這只用在 select 選項裡，其他展示地方（餘額、轉帳）仍用 `labelUser`。

---

## Feature C：真實頭貼

### 方案概述
- **自己的頭貼**：`WebApp.initDataUnsafe.user?.photo_url`，client 直接取，即時。
- **其他人 + 群組頭貼**：新增 `GET /api/groups/[id]/avatars`，server 用 grammy `Api` 打 Telegram Bot API，module-level TTL cache（4 小時）。
- **Avatar 元件**：圓形，有 src 就顯示圖片，否則顯示名字首字母（顏色用 `userId % 8` hash）。

### 新增：`src/app/api/groups/[id]/avatars/route.ts`
```ts
import { Api } from "grammy";
import { serverEnv } from "@/lib/env";
// ...

// Module-level cache: key = groupId, value = { data, expires }
const cache = new Map<number, { data: AvatarsResponse; expires: number }>();
const TTL = 4 * 60 * 60 * 1000;

type AvatarsResponse = {
  groupPhoto: string | null;
  userPhotos: Record<number, string | null>; // userId → URL
};

export const GET = withAuth(async (req, { params }) => {
  // 1. auth + groupId
  // 2. Check cache → return if fresh
  // 3. Fetch members (id, telegramId) + group (telegramChatId) from DB
  // 4. Create tgApi = new Api(serverEnv().TELEGRAM_BOT_TOKEN)
  // 5. Promise.allSettled([
  //      getUserProfilePhotos for each member,
  //      getChat for group photo
  //    ])
  // 6. For each resolved photo: getFile(fileId) → build URL
  //    URL pattern: `https://api.telegram.org/file/bot${token}/${file.file_path}`
  // 7. Set cache, return JSON
});
```

#### 注意
- `getUserProfilePhotos` 用 `telegramId`（bigint），不是 internal `userId`。
- 回傳 key 是 internal `userId`（方便 client 對應）。
- 若某人沒有頭貼或 Bot API 拋錯，回傳 `null`（client fallback 到 initials）。
- `getChat` 若群組沒有頭貼，`chat.photo` 是 undefined。
- `Promise.allSettled` 保證單一失敗不影響其他人。

### 新增：`src/components/mini/Avatar.tsx`
```tsx
type Props = {
  src?: string | null;
  name: string;
  userId: number;
  size?: "sm" | "md" | "lg"; // 24 / 32 / 40 px
};

const COLORS = [
  "bg-rose-400", "bg-orange-400", "bg-amber-400", "bg-green-500",
  "bg-teal-500", "bg-sky-500", "bg-violet-500", "bg-pink-500",
];

export function Avatar({ src, name, userId, size = "md" }: Props) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const color = COLORS[userId % COLORS.length];
  const sizeClass = size === "sm" ? "size-6 text-[10px]" : size === "lg" ? "size-10 text-sm" : "size-8 text-xs";

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={`${sizeClass} rounded-full object-cover`}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  return (
    <span className={`${sizeClass} ${color} inline-flex items-center justify-center rounded-full font-medium text-white shrink-0`}>
      {initials || "?"}
    </span>
  );
}
```

### 修改：`src/app/mini/groups/[id]/page.tsx`
```ts
// 新增 SWR key
const { data: avatars } = useSWR<AvatarsResponse>(`/api/groups/${id}/avatars`);

// helper
function getPhoto(userId: number): string | null {
  return avatars?.userPhotos[userId] ?? null;
}
```

在餘額列表、轉帳列表、支出明細的 `<li>` 裡加 `<Avatar>` 元件：
```tsx
// balance item
<li key={b.userId} className="flex items-center gap-2">
  <Avatar src={getPhoto(b.userId)} name={labelUser(b)} userId={b.userId} size="sm" />
  <span className="flex-1">{labelUser(b, selfUserId)}</span>
  ...
</li>
```

### 修改：`src/components/mini/ExpenseForm.tsx`
- 加 `avatars?: Record<number, string | null>` prop（可選，由 page 傳入）
- 參與者清單的每個 `<li>` 加 `<Avatar>` size="sm"

---

## 受影響檔案總表

新增：
- `src/lib/label.ts`
- `src/components/mini/Avatar.tsx`
- `src/app/api/groups/[id]/avatars/route.ts`

修改：
- `src/app/api/groups/[id]/expenses/route.ts`（+lastName）
- `src/app/api/groups/[id]/balance/route.ts`（+lastName）
- `src/app/api/groups/[id]/members/route.ts`（+lastName）
- `src/app/api/groups/[id]/stats/route.ts`（+lastName）
- `src/app/api/groups/[id]/settle/route.ts`（+lastName，bot /settle 用）
- `src/app/mini/groups/[id]/page.tsx`（selfUserId + avatars + labelUser）
- `src/app/mini/groups/[id]/stats/page.tsx`（labelUser）
- `src/components/mini/ExpenseForm.tsx`（labelMember + Avatar）

---

## 實作建議順序

1. `src/lib/label.ts` + Feature B（API routes +lastName + type 更新）— 純後端/型別，影響小，typecheck 先過
2. Feature A（group page +selfUserId，labelUser 替換）
3. Feature C（Avatar 元件 → avatars route → page 整合）

---

## 驗證方式

1. 餘額卡：自己那列顯示「你」，其他人顯示全名（含 lastName）
2. 轉帳建議：「你」→「陳大明」格式正確
3. 支出明細：付款人「你」、拆帳列表各人全名
4. ExpenseForm 下拉：顯示 `「陳大明 (@john)」`
5. 頭貼：自己 + 其他成員圓形照片、無頭貼 fallback 到 initials circle
6. `pnpm typecheck` + `pnpm test` 全綠
