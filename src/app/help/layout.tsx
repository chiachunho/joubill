"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";

const sections = [
  { slug: "getting-started", label: "快速入門" },
  { slug: "adding-expenses", label: "記帳（加入費用）" },
  { slug: "balances", label: "查看帳務" },
  { slug: "settlement", label: "結清" },
  { slug: "multi-currency", label: "多幣別" },
  { slug: "group-management", label: "群組與成員" },
  { slug: "stats", label: "統計" },
  { slug: "web-app", label: "網頁版" },
  { slug: "troubleshooting", label: "常見問題" },
];

function NavLinks({ onNav }: { onNav?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {sections.map((s) => {
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
            className="absolute left-0 top-14 w-64 border-r border-border/40 bg-background p-4 shadow-lg"
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
