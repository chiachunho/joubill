# Mini App 設計系統 / Design System

> Mini App (`/mini/**`) 的視覺規範。**動手改 UI 前先讀這份。**
> 目標:任何頁面、任何元件都從同一套 token 與 pattern 長出來,避免「每個元件圓角不一樣」這種漂移再發生。

核心原則:**永遠用 token,不要寫死數值。** 看到要用 `rounded-[9px]`、`#10b981`、`text-[13px]` 之前,先回來看這份有沒有對應的 token。

---

## 1. 顏色 Color

顏色**全部走 shadcn CSS 變數**(`hsl(var(--…))`),這些變數在 runtime 由 Telegram 主題參數覆寫(見 [`use-tg-theme.ts`](../src/lib/use-tg-theme.ts))。**禁止在元件裡寫死 hex / 具名 Tailwind 顏色當品牌色**,否則切換 Telegram 深淺色主題會壞掉。

### 品牌色票 (Brand Palette)

當 Telegram 主題未套用時，`globals.css` 的 `:root` 預設值使用以下品牌色：

| 名稱 | HEX | CSS 變數 | 用途 |
| --- | --- | --- | --- |
| 揪綠 | `#2EBD8F` | `--primary` / `--ring` | 主行動按鈕、選中態 |
| 帳金 | `#F5B731` | `--brand-gold` | 財務亮點（見下方說明） |
| 深綠 | `#1F9D74` | — | 深色版揪綠，目前保留於 dark mode `--primary` 參考 |
| 米白 | `#F2F0EB` | `--background` | 頁面底色 |
| 墨黑 | `#1A1A1A` | `--foreground` | 主要文字 |

#### 帳金 (`--brand-gold`) 使用規則

帳金是財務語境的點綴色，**不走 Tailwind 語義 class**，需直接引用 CSS 變數：

```tsx
// 金額欄位的強調底色
<span style={{ color: "hsl(var(--brand-gold))" }}>...</span>

// 或透過 Tailwind arbitrary value
<span className="text-[hsl(var(--brand-gold))]">...</span>
```

帳金**不取代** `text-emerald-500` / `text-rose-500`（正負餘額語意色保持不變），僅用於「中性金額強調」（如累計金額、未結算總額）。

### 標準語義 class

| 用途 | class | 說明 |
| --- | --- | --- |
| 頁面背景 | `bg-background` | 跟隨 TG `bg_color`；預設米白 |
| 主要文字 | `text-foreground` | |
| 次要 / 提示文字 | `text-muted-foreground` | 日期、說明、單位 |
| 面板底色 | `bg-secondary/50` | grouped panel 專用(見 §5) |
| 分隔線 | `divide-border/40`、`border-border` | |
| 主行動 | `bg-primary text-primary-foreground` | 主按鈕、選中態；預設揪綠 |
| 主色淡底 | `bg-primary/10 text-primary` | 次要 pill、icon tile |

**唯二允許的具名顏色** — 僅用於財務數字的正負,語意固定:

- 正 / 應收:`text-emerald-500`
- 負 / 應付:`text-rose-500`
- 錯誤態背景:`bg-destructive/10 text-destructive`

頭像底色是例外:[`Avatar.tsx`](../src/components/mini/Avatar.tsx) 內建一組固定色盤,依 `userId` 取模,不要在外面另外指定。

---

## 2. 圓角 Radius —— 只有兩階

圓角全部由 `--radius` 衍生(`globals.css` 定義為 `0.625rem` = 10px;`tailwind.config.ts` 把 `lg/md/sm` 綁到它)。**就兩個階層,不要再發明第三種:**

| 階層 | class | 值 | 用在 |
| --- | --- | --- | --- |
| **容器 Container** | `rounded-2xl` | 16px | grouped panel、卡片、icon tile、大區塊 |
| **控制元件 Control** | `rounded-lg` | 10px | 所有 button / input / select / pill / segmented toggle |

巢狀的內層(例如 segmented toggle 內的選項)用 `rounded-md`(8px),剛好對齊外層 `rounded-lg` + `p-0.5`。圓形(頭像、icon)用 `rounded-full`。

> ⚠️ **不要用 `rounded-xl` 或 `rounded-[Npx]`。** shadcn 的 `Button`/`Input`/`SelectTrigger` 已統一改成 `rounded-lg`,自訂控制元件也一律 `rounded-lg`——直接沿用,不要 override。容器一律 `rounded-2xl`。

---

## 3. 字體與數字 Typography

- 字體:**Plus Jakarta Sans**,在 [`layout.tsx`](../src/app/layout.tsx) 以 `--font-sans` 載入,`font-sans` 自動套用。不要再 import 其他字體。
- **財務數字一律加 `.num`**(`globals.css`):啟用 `tabular-nums` + 收緊字距,讓金額對齊。任何顯示金額、百分比、餘額的地方都要加。
- **區塊小標一律用 `.sect`**:大寫、字距放寬的 micro-label,放在 grouped panel 上方(例:`Balance · TWD`、`Expenses (12)`)。
- 頁面標題:`text-lg font-semibold`(不要 `text-xl font-bold`,那是舊樣式)。
- 內文:預設 `text-sm`;輔助資訊 `text-xs text-muted-foreground`。

---

## 4. 間距與版面 Spacing & Layout

- 頁面左右留白:`px-4`(`mini/layout.tsx` 的 `<main>` 已限制 `max-w-xl`,頁面自己負責左右 padding)。
- 區塊之間:容器外層 `space-y-6 py-4`。
- panel row 內距:`px-4 py-3`。
- `.sect` 與其下 panel 的間距:`mb-2.5`。

---

## 5. 核心 Pattern:Grouped Panel

iOS 風格的分組面板,是列表 / 餘額 / 參與者的標準容器:

```tsx
<section className="px-4">
  <p className="sect mb-2.5">Balance · TWD</p>
  <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
    {/* 每個 row: flex items-center gap-3 px-4 py-3 */}
  </div>
</section>
```

要點:`rounded-2xl` + `bg-secondary/50` + `overflow-hidden` + `divide-y divide-border/40`。列表 row 統一 `flex items-center gap-3 px-4 py-3`,左頭像、中文字、右金額(`.num`)。

---

## 6. 三種狀態 States(每個資料頁都要有)

| 狀態 | 做法 |
| --- | --- |
| **Loading** | **不要用 spinner**。用頁面形狀的 skeleton —— [`skeletons.tsx`](../src/components/mini/skeletons.tsx) 已有對應每頁的 export。新頁面要新增對應 skeleton,沿用裡面的 `Skeleton` primitive 與 panel 形狀。 |
| **Empty** | 置中、`text-sm text-muted-foreground`,視情況加一個 `size-14 rounded-2xl bg-secondary` 的 icon tile。 |
| **Error** | 置中文案 + 細的 `text-xs text-muted-foreground/60` 錯誤明細。 |

---

## 7. 圖示 Icons

- 一律用 [`lucide-react`](https://lucide.dev),尺寸 `size-3.5` ~ `size-4`。
- **控制元件(按鈕)不要放 emoji**——用 lucide icon。(慶祝性質的純文字訊息可以用 emoji,例如「已結清 🎉」。)

---

## 8. 改動前的 checklist

- [ ] 圓角只用了 `rounded-2xl`(容器)/ `rounded-lg`(控制)/ `rounded-full`?沒有 `rounded-xl`、`rounded-[…]`?
- [ ] 顏色都走 CSS 變數?沒有寫死品牌 hex?正負金額用 emerald/rose?
- [ ] 金額有 `.num`?區塊有 `.sect` 小標?
- [ ] Loading 是 skeleton 不是 spinner?Empty / Error 狀態都有?
- [ ] 用了既有 shadcn / `components/mini` 元件,而不是重刻一個?
