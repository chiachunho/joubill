# Mini App Design System

> 中文版：[design-system.zh-TW.md](design-system.zh-TW.md)

> Visual conventions for the Mini App (`/mini/**`). **Read this before touching any UI.**
> Goal: every page and component grows from the same set of tokens and patterns,
> so the "every component has a slightly different corner radius" kind of drift never happens again.

Core principle: **always use tokens, never hardcode values.** Before reaching for
`rounded-[9px]`, `#10b981`, or `text-[13px]`, come back here and check whether a
token already covers it.

---

## 1. Color

Colors **all go through shadcn CSS variables** (`hsl(var(--…))`); those variables
are overridden at runtime by Telegram theme params (see
[`use-tg-theme.ts`](../src/lib/use-tg-theme.ts)). **Never hardcode a hex /
named-Tailwind color as a brand color in a component** — switching Telegram
light/dark themes would break it.

### Brand palette

When no Telegram theme is applied, `globals.css`'s `:root` defaults use these brand colors:

| Name        | HEX       | CSS variable           | Use                                                                  |
| ----------- | --------- | ---------------------- | -------------------------------------------------------------------- |
| Jiu-green   | `#2EBD8F` | `--primary` / `--ring` | primary action buttons, selected state                               |
| Ledger-gold | `#F5B731` | `--brand-gold`         | financial highlights (see below)                                     |
| Deep green  | `#1F9D74` | —                      | dark variant of jiu-green; kept as a dark-mode `--primary` reference |
| Off-white   | `#F2F0EB` | `--background`         | page background                                                      |
| Ink-black   | `#1A1A1A` | `--foreground`         | primary text                                                         |

#### Ledger-gold (`--brand-gold`) rules

Ledger-gold is an accent for financial contexts. It does **not** go through a
Tailwind semantic class — reference the CSS variable directly:

```tsx
// emphasis color for an amount field
<span style={{ color: "hsl(var(--brand-gold))" }}>...</span>

// or via a Tailwind arbitrary value
<span className="text-[hsl(var(--brand-gold))]">...</span>
```

Ledger-gold does **not** replace `text-emerald-500` / `text-rose-500` (the
positive/negative balance semantics stay); it's only for "neutral amount
emphasis" (e.g. cumulative totals, unsettled sums).

### Standard semantic classes

| Use                   | class                                | Notes                                                 |
| --------------------- | ------------------------------------ | ----------------------------------------------------- |
| Page background       | `bg-background`                      | follows TG `bg_color`; defaults to off-white          |
| Primary text          | `text-foreground`                    |                                                       |
| Secondary / hint text | `text-muted-foreground`              | dates, descriptions, units                            |
| Panel background      | `bg-secondary/50`                    | for grouped panels (see §5)                           |
| Dividers              | `divide-border/40`, `border-border`  |                                                       |
| Primary action        | `bg-primary text-primary-foreground` | primary button, selected state; defaults to jiu-green |
| Tinted primary        | `bg-primary/10 text-primary`         | secondary pills, icon tiles                           |

**The only two named colors allowed** — strictly for the sign of financial figures:

- positive / receivable: `text-emerald-500`
- negative / payable: `text-rose-500`
- error-state background: `bg-destructive/10 text-destructive`

Avatar background colors are an exception: [`Avatar.tsx`](../src/components/mini/Avatar.tsx)
has a fixed built-in palette keyed by `userId` modulo — don't override it from outside.

---

## 2. Radius — only two tiers

Radius is all derived from `--radius` (`globals.css` defines it as `0.625rem` =
10px; `tailwind.config.ts` binds `lg/md/sm` to it). **Just two tiers — don't
invent a third:**

| Tier          | class         | value | used for                                               |
| ------------- | ------------- | ----- | ------------------------------------------------------ |
| **Container** | `rounded-2xl` | 16px  | grouped panels, cards, icon tiles, large blocks        |
| **Control**   | `rounded-lg`  | 10px  | all button / input / select / pill / segmented toggles |

Nested inner elements (e.g. options inside a segmented toggle) use `rounded-md`
(8px), which aligns neatly with an outer `rounded-lg` + `p-0.5`. Circles
(avatars, icons) use `rounded-full`.

> ⚠️ **Don't use `rounded-xl` or `rounded-[Npx]`.** shadcn's `Button`/`Input`/`SelectTrigger`
> are unified to `rounded-lg`; custom controls are also always `rounded-lg` — reuse
> it, don't override. Containers are always `rounded-2xl`.

---

## 3. Typography & numbers

- Font: **Plus Jakarta Sans**, loaded in [`layout.tsx`](../src/app/layout.tsx) as `--font-sans`; `font-sans` applies it automatically. Don't import other fonts.
- **Financial numbers always get `.num`** (`globals.css`): enables `tabular-nums` + tighter tracking so amounts line up. Add it anywhere you show an amount, percentage, or balance.
- **Section micro-labels always use `.sect`**: uppercase, widened-tracking micro-label above a grouped panel (e.g. `餘額 · TWD`, `紀錄 (12)`).
- Page titles: `text-lg font-semibold` (not `text-xl font-bold` — that's the old style).
- Body: `text-sm` by default; supporting info `text-xs text-muted-foreground`.

---

## 4. Spacing & layout

- Page horizontal padding: `px-4` (`mini/layout.tsx`'s `<main>` already caps `max-w-xl`; pages own their left/right padding).
- Between blocks: outer container `space-y-6 py-4`.
- Panel row padding: `px-4 py-3`.
- Gap between a `.sect` and its panel: `mb-2.5`.

---

## 5. Core pattern: grouped panel

The iOS-style grouped panel is the standard container for lists / balances / participants:

```tsx
<section className="px-4">
  <p className="sect mb-2.5">Balance · TWD</p>
  <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
    {/* each row: flex items-center gap-3 px-4 py-3 */}
  </div>
</section>
```

Key points: `rounded-2xl` + `bg-secondary/50` + `overflow-hidden` + `divide-y
divide-border/40`. List rows are uniformly `flex items-center gap-3 px-4 py-3` —
avatar left, text middle, amount right (`.num`).

---

## 6. Nav rows & collapsible sections

Two variants of a section, beyond a plain grouped panel of data rows:

**Nav row** — a single-row panel that hands a whole sub-topic off to its own
page instead of expanding it inline. Use this when the content has its own
forms/lists heavy enough to dominate the page it'd sit on — e.g. 貨幣與匯率
(預設貨幣, 時區 and the 自訂匯率 list) and 匯出 (CSV and Beancount) on the group
settings page each moved to their own `settings/rates` / `settings/export` page, leaving a nav row
behind. Every single entry of that page shares one card with no section titles; only 成員, a list
of people, keeps a block of its own. Shape:
icon tile + label + `ChevronRight`, **no secondary status text** — keep it as
plain as 動態紀錄's row. A status line ("已啟用" / "N 筆設定") invites a second
question — what does the empty/zero state say? — that a plain label sidesteps
entirely.

Use `NavRow` (`components/mini/NavRow.tsx`) rather than writing the row again; a row
that acts instead of navigating (download, send) is `ActionRow`, and both draw their
icon with `IconTile`. Spelled out, the nav row is:

```tsx
<Link
  href={`/mini/groups/${id}/settings/rates`}
  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 active:bg-accent/50"
>
  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
    <Coins className="size-3.5" />
  </span>
  <p className="min-w-0 flex-1 text-sm">貨幣與匯率</p>
  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" />
</Link>
```

**Collapsible section** — `Accordion` / `AccordionItem` / `AccordionTrigger` /
`AccordionContent` (`components/ui/accordion.tsx`, wraps
`@radix-ui/react-accordion`). Use only for secondary or low-frequency content
that would otherwise add scroll weight to a page everyone visits — not as a
general "make the page shorter" trick. Default collapsed
(`<Accordion type="single" collapsible>`, no `defaultValue`); `AccordionTrigger`
takes the same `.sect` label the section would otherwise use, so a collapsed
section reads identically to an ordinary section header until tapped.

**Never hide an actionable state.** `DeleteGroupRow`, the last row of the group
settings card, is one red row while idle. A pending delete request — yours to
cancel, or someone else's to approve/reject — shows in that row directly, on a
tinted background, with its buttons. Anything a user has to know to open or
scroll to is the wrong place for something that needs their attention right now.

---

## 7. The three states (every data page needs them)

| State       | Approach                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Loading** | **No spinner.** Use page-shaped skeletons — [`skeletons.tsx`](../src/components/mini/skeletons.tsx) already exports one per page. New pages add a matching skeleton, reusing the `Skeleton` primitive and panel shapes inside. |
| **Empty**   | Centered, `text-sm text-muted-foreground`, optionally a `size-14 rounded-2xl bg-secondary` icon tile.                                                                                                                          |
| **Error**   | Centered message + a thin `text-xs text-muted-foreground/60` error detail.                                                                                                                                                     |

---

## 8. Icons

- Always [`lucide-react`](https://lucide.dev), size `size-3.5` ~ `size-4`.
- **No emoji on controls (buttons)** — use a lucide icon. (Celebratory plain-text messages may use emoji, e.g. "Settled 🎉".)

---

## 9. Pre-change checklist

- [ ] Radius is only `rounded-2xl` (container) / `rounded-lg` (control) / `rounded-full`? No `rounded-xl`, `rounded-[…]`?
- [ ] All colors go through CSS variables? No hardcoded brand hex? Positive/negative amounts use emerald/rose?
- [ ] Amounts have `.num`? Sections have a `.sect` micro-label?
- [ ] Loading is a skeleton, not a spinner? Empty / Error states both present?
- [ ] Reused existing shadcn / `components/mini` components instead of re-rolling one?
- [ ] A block heavy enough to need its own forms/lists moved to a nav row + sub-page, rather than expanding inline? A collapsed section only used for genuinely secondary content, never for something the user needs to act on right now?
