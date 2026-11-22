"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Copy, Check, Eye, Pencil, Plus, Sparkles } from "lucide-react";

import { EmptyState } from "@/components/mini/EmptyState";
import { PageHeader } from "@/components/mini/PageHeader";
import { Panel, Section } from "@/components/mini/Panel";
import { CreateAppTokenDialog } from "@/components/mini/CreateAppTokenDialog";
import { LinkedAppsSkeleton } from "@/components/mini/skeletons";
import { Pill } from "@/components/mini/Pill";
import { LoadError } from "@/components/mini/LoadError";
import { Button } from "@/components/ui/button";
import type { Platform } from "@/components/pages/platform";
import { useLoginRedirect } from "@/components/pages/use-login-redirect";
import { connectionStatus } from "@/lib/mcp-connection-input";
import {
  ACCESS_LABEL,
  expiryLabel,
  lastUsedLabel,
  scopeSummary,
  usableConnections,
} from "@/lib/app-ui";
import { describeError } from "@/lib/api-error";
import { MCP_HELP_PATH, MCP_PATH } from "@/lib/help-url";
import { cn } from "@/lib/utils";
import { useCopy } from "@/lib/use-copy";
import { useGetMcpConnectionsQuery, useGetMeQuery } from "@/store/api";

/**
 * 個人設定 → 連結的應用程式 (issue #150): the address to connect to, the connections that exist,
 * and 建立個人存取權杖. Shared by `/mini` and `/app`; nothing here depends on the platform but
 * the back link and where a signed-out viewer goes.
 */
export function LinkedAppsPage({ platform }: { platform: Platform }) {
  const back = `${platform.basePath}/settings`;
  platform.useBack(back);

  const { data, error } = useGetMcpConnectionsQuery();
  const { data: me } = useGetMeQuery();
  const redirectToLogin = useLoginRedirect(error, platform.loginPath);
  const [creating, setCreating] = useState(false);
  const clip = useCopy();
  const copied = clip.copied !== null;
  const manual = clip.refused !== null;

  // The host the person actually opened, not the build-time `NEXT_PUBLIC_MINI_APP_URL`, which a
  // preview deployment may have set to another domain. A function because `window` does not
  // exist during SSR; it is only called once the data has loaded (after the early returns).
  const mcpUrl = () => new URL(MCP_PATH, window.location.origin).toString();
  const groups = me?.groups ?? [];

  const copyUrl = () => void clip.copy(mcpUrl());

  if (error && !redirectToLogin) {
    return <LoadError detail={describeError(error)} />;
  }
  if (!data) return <LinkedAppsSkeleton />;

  const url = mcpUrl();
  const list = usableConnections(data.connections);

  return (
    <div className="space-y-6 py-4">
      <PageHeader
        back={<platform.BackLink href={back} />}
        title="連結的應用程式"
        description="MCP 是讓 Claude、ChatGPT、Cursor
          或自動化流程連進揪帳的方式，連上後可以查帳、記帳。它們記的每一筆，群組都會看到是透過它記錄的。"
      />

      <Section title="MCP 伺服器網址">
        <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2">
          <input
            readOnly
            value={url}
            aria-label="MCP 伺服器網址"
            onFocus={(e) => e.currentTarget.select()}
            className="num min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
          <Button variant="ghost" size="sm" className="shrink-0 rounded-lg" onClick={copyUrl}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "已複製" : "複製"}
          </Button>
        </div>
        <p
          className={cn(
            "mt-1.5 px-0.5 text-xs",
            manual ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {manual
            ? "無法自動複製，請長按或選取上面的網址複製"
            : "在 Claude 或 ChatGPT「新增連接器」貼上這個網址。"}
        </p>
      </Section>

      <Section title="已連結">
        {list.length === 0 ? (
          <EmptyState icon={Sparkles} title="還沒有連結的應用程式">
            建立個人存取權杖，或用上面的網址新增連接器
          </EmptyState>
        ) : (
          <Panel>
            {list.map((c) => {
              const expired = connectionStatus(c) === "expired";
              return (
                <Link
                  key={c.id}
                  href={`${platform.basePath}/settings/apps/${c.id}`}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30 active:bg-accent/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{c.name}</span>
                      <Pill tone="primary" strong>
                        {c.access === "read" ? (
                          <Eye className="size-3" aria-hidden />
                        ) : (
                          <Pencil className="size-3" aria-hidden />
                        )}
                        {ACCESS_LABEL[c.access]}
                      </Pill>
                      {expired && <Pill>已到期</Pill>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {scopeSummary(c, groups)} · {lastUsedLabel(c.lastUsedAt)}
                      {!expired && c.expiresAt ? ` · ${expiryLabel(c.expiresAt)}` : ""}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
                </Link>
              );
            })}
          </Panel>
        )}
        <Button
          className="mt-3 w-full rounded-lg"
          onClick={() => setCreating(true)}
          disabled={groups.length === 0}
        >
          <Plus className="size-4" />
          建立個人存取權杖
        </Button>
        <p className="mt-1.5 px-0.5 text-xs text-muted-foreground">
          個人存取權杖給 Claude Code、Cursor、n8n、捷徑等可以自己填 Header 的工具使用。
        </p>
        <platform.HelpAction
          path={MCP_HELP_PATH}
          className="mt-3 flex w-full items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/30 active:bg-accent/50"
        >
          <span className="flex-1">設定範例與說明</span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
        </platform.HelpAction>
      </Section>

      <CreateAppTokenDialog open={creating} onOpenChange={setCreating} groups={groups} />
    </div>
  );
}
