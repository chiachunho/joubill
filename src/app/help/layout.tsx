"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";

/**
 * The sidebar, in groups. Adding a page means adding its `page.mdx` and an entry here: a page
 * without one is unreachable. A renamed or merged page also gets a redirect in next.config.mjs.
 */
const groups: { title: string; pages: { slug: string; label: string }[] }[] = [
  {
    title: "開始使用",
    pages: [
      { slug: "getting-started", label: "快速入門" },
      { slug: "account", label: "登入與帳號" },
    ],
  },
  {
    title: "記帳與還款",
    pages: [
      { slug: "adding-expenses", label: "記帳" },
      { slug: "settlement", label: "還款" },
      { slug: "multi-currency", label: "多幣別" },
    ],
  },
  {
    title: "看帳",
    pages: [
      { slug: "balances", label: "查看帳務" },
      { slug: "stats", label: "統計" },
      { slug: "export", label: "匯出" },
    ],
  },
  {
    title: "群組",
    pages: [
      { slug: "members", label: "成員" },
      { slug: "group-settings", label: "群組設定" },
    ],
  },
  {
    title: "更多",
    pages: [
      { slug: "add-to-home-screen", label: "加到主畫面與通知" },
      { slug: "mcp", label: "連結 AI 工具（MCP）" },
    ],
  },
  {
    title: "說明",
    pages: [
      { slug: "troubleshooting", label: "常見問題" },
      { slug: "privacy", label: "隱私權政策" },
      { slug: "terms", label: "服務條款" },
    ],
  },
];

function NavLinks({ onNav }: { onNav?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.title} className="flex flex-col gap-0.5">
          <p className="sect mb-1 px-3">{g.title}</p>
          {g.pages.map((s) => {
            const href = `/help/${s.slug}`;
            const active = pathname === href;
            return (
              <Link
                key={s.slug}
                href={href}
                onClick={onNav}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-foreground/70 hover:bg-secondary hover:text-foreground",
                )}
              >
                {s.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* top bar */}
      <header className="sticky top-0 z-30 border-b border-border/40 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <button
            className="rounded-lg p-1.5 text-foreground/60 hover:bg-secondary md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="目錄"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
          <Link href="/help/getting-started" className="flex items-center gap-2">
            <Logo size={28} />
            <span className="text-base font-semibold text-foreground">揪帳說明</span>
          </Link>
          <div className="ml-auto">
            <Link
              href="/app"
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              開啟揪帳
            </Link>
          </div>
        </div>
      </header>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-20 md:hidden" onClick={() => setOpen(false)}>
          <div
            className="absolute left-0 top-14 max-h-[calc(100vh-3.5rem)] w-64 overflow-y-auto border-r border-border/40 bg-background p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <NavLinks onNav={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="mx-auto flex max-w-5xl gap-0">
        {/* sidebar */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 overflow-y-auto border-r border-border/40 p-5 md:block">
          <NavLinks />
        </aside>

        {/* content */}
        <main className="min-w-0 flex-1 px-6 py-8 md:px-10">{children}</main>
      </div>
    </div>
  );
}
