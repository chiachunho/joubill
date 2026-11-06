"use client";

import Link from "next/link";
import { ChevronRight, Sparkles } from "lucide-react";

import type { Platform } from "@/components/pages/platform";
import { activeConnections } from "@/lib/agent-ui";
import { useGetAgentConnectionsQuery } from "@/store/api";

/**
 * 個人設定's AI 助理 block, under 登入方式: both answer "who can act as my account". A
 * failed or pending read shows the row without a count rather than hiding the way in.
 */
export function AgentsSection({ platform }: { platform: Platform }) {
  const { data } = useGetAgentConnectionsQuery();
  const active = data ? activeConnections(data.connections) : null;

  return (
    <section className="px-4">
      <p className="sect mb-2.5">AI 助理</p>
      <div className="overflow-hidden rounded-2xl bg-secondary/50">
        <Link
          href={`${platform.basePath}/settings/agents`}
          className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 active:bg-accent/50"
        >
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="size-3.5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm">已連線的 AI 助理</p>
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
