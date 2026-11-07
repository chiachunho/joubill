"use client";

import Link from "next/link";
import { ChevronRight, Sparkles } from "lucide-react";

import { IconTile } from "@/components/mini/IconTile";
import type { Platform } from "@/components/pages/platform";
import { activeConnections } from "@/lib/app-ui";
import { useGetMcpConnectionsQuery } from "@/store/api";

/**
 * 個人設定's 連結的應用程式 block, under 登入方式: both answer "who can act as my account". A
 * failed or pending read shows the row without a count rather than hiding the way in.
 */
export function LinkedAppsSection({ platform }: { platform: Platform }) {
  const { data } = useGetMcpConnectionsQuery();
  const active = data ? activeConnections(data.connections) : null;

  return (
    <section className="px-4">
      <p className="sect mb-2.5">連結的應用程式</p>
      <div className="overflow-hidden rounded-2xl bg-secondary/50">
        <Link
          href={`${platform.basePath}/settings/apps`}
          className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 active:bg-accent/50"
        >
          <IconTile icon={Sparkles} />
          <div className="min-w-0 flex-1">
            <p className="text-sm">已連結的應用程式</p>
            {active && active.length > 0 && (
              <p className="truncate text-xs text-muted-foreground">
                {active.map((c) => c.name).join("、")}
              </p>
            )}
          </div>
          {active && <span className="num text-sm text-muted-foreground">{active.length}</span>}
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
        </Link>
      </div>
    </section>
  );
}
