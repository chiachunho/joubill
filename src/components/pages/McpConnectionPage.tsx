"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2 } from "lucide-react";

import {
  AppAccessPicker,
  AppScopePicker,
  scopeIsValid,
  type Scope,
} from "@/components/mini/AppFormFields";
import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { LinkedAppsSkeleton } from "@/components/mini/skeletons";
import { Button } from "@/components/ui/button";
import type { Platform } from "@/components/pages/platform";
import { useLoginRedirect } from "@/components/pages/use-login-redirect";
import { connectionStatus } from "@/lib/mcp-connection-input";
import { expiryLabel, lastUsedLabel, sameScope, usableConnections } from "@/lib/app-ui";
import { apiErrorText, describeError } from "@/lib/api-error";
import type { McpConnectionItem } from "@/lib/api-types";
import {
  useGetMcpConnectionsQuery,
  useGetMeQuery,
  useRevokeMcpConnectionMutation,
  useUpdateMcpConnectionMutation,
} from "@/store/api";

/**
 * 連結的應用程式 → one connection: change its permission and group scope, or revoke it. The name
 * and the expiry are shown but not editable (the audit log quotes the name, and a longer expiry is
 * a new token). Widening to 可記帳 asks first; narrowing saves straight away. Shared by `/mini`
 * and `/app`.
 */
export function McpConnectionPage({
  params,
  platform,
}: {
  params: Promise<{ id: string }>;
  platform: Platform;
}) {
  const { id } = use(params);
  const connectionId = Number(id);
  const back = `${platform.basePath}/settings/apps`;
  platform.useBack(back);

  const { data, error } = useGetMcpConnectionsQuery();
  const { data: me } = useGetMeQuery();
  const redirectToLogin = useLoginRedirect(error, platform.loginPath);

  if (error && !redirectToLogin) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{describeError(error)}</p>
      </div>
    );
  }
  if (!data || !me) return <LinkedAppsSkeleton />;

  const connection = usableConnections(data.connections).find((c) => c.id === connectionId);
  if (!connection) {
    return (
      <div className="px-4 py-4">
        <platform.BackLink href={back} />
        <p className="py-12 text-center text-sm text-muted-foreground">找不到這個連線</p>
      </div>
    );
  }

  return (
    <ConnectionForm
      // Start from the saved values whenever another connection is shown.
      key={connection.id}
      connection={connection}
      groups={me.groups}
      platform={platform}
      back={back}
    />
  );
}

function ConnectionForm({
  connection,
  groups,
  platform,
  back,
}: {
  connection: McpConnectionItem;
  groups: { id: number; title: string; defaultCurrency: string }[];
  platform: Platform;
  back: string;
}) {
  const router = useRouter();
  const [update, { isLoading: saving }] = useUpdateMcpConnectionMutation();
  const [revoke, { isLoading: revoking }] = useRevokeMcpConnectionMutation();
  const [access, setAccess] = useState(connection.access);
  const [scope, setScope] = useState<Scope>({
    allGroups: connection.allGroups,
    groupIds: connection.groupIds,
  });
  const [confirm, setConfirm] = useState<"widen" | "revoke" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const expired = connectionStatus(connection) === "expired";
  const accessChanged = access !== connection.access;
  const scopeChanged = !sameScope(scope, connection);
  const dirty = accessChanged || scopeChanged;
  const widening = access === "write" && connection.access === "read";

  async function save() {
    setError(null);
    try {
      await update({
        id: connection.id,
        ...(accessChanged ? { access } : {}),
        ...(scopeChanged
          ? { allGroups: scope.allGroups, groupIds: scope.allGroups ? [] : scope.groupIds }
          : {}),
      }).unwrap();
      router.replace(back);
    } catch (e) {
      setError(apiErrorText(e, "儲存失敗"));
    } finally {
      setConfirm(null);
    }
  }

  async function doRevoke() {
    setError(null);
    try {
      await revoke({ id: connection.id }).unwrap();
      router.replace(back);
    } catch (e) {
      setError(apiErrorText(e, "撤銷失敗"));
    } finally {
      setConfirm(null);
    }
  }

  return (
    <div className="space-y-6 py-4">
      <div className="px-4">
        <platform.BackLink href={back} />
        <h1 className="truncate text-lg font-semibold">{connection.name}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {connection.kind === "oauth" ? "OAuth 連線" : `個人存取權杖 ${connection.tokenPrefix}…`}
          {" · "}
          {lastUsedLabel(connection.lastUsedAt)}
          {" · "}
          {expired ? "已到期" : expiryLabel(connection.expiresAt)}
        </p>
      </div>

      <div className="space-y-4 px-4">
        <Link
          href={`${platform.basePath}/settings/apps/${connection.id}/calls`}
          className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2.5 text-sm transition-colors hover:bg-accent/30 active:bg-accent/50"
        >
          <span className="flex-1">
            使用紀錄
            <span className="block text-xs text-muted-foreground">最近的工具呼叫與結果</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
        </Link>
        <AppAccessPicker value={access} onChange={setAccess} />
        <AppScopePicker groups={groups} value={scope} onChange={setScope} />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="space-y-2 px-4">
        <Button
          className="w-full rounded-lg"
          disabled={!dirty || !scopeIsValid(scope) || saving}
          onClick={() => (widening ? setConfirm("widen") : save())}
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          儲存變更
        </Button>
        <Button
          variant="outline"
          className="w-full rounded-lg text-destructive hover:text-destructive"
          disabled={revoking}
          onClick={() => setConfirm("revoke")}
        >
          撤銷這個連線
        </Button>
      </div>

      <ConfirmDialog
        open={confirm === "widen"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`讓「${connection.name}」可以記帳？`}
        description="它之後可以新增、編輯、刪除紀錄與還款，群組會看到是透過它記錄的。"
        confirmLabel="允許記帳"
        loading={saving}
        onConfirm={save}
      />
      <ConfirmDialog
        open={confirm === "revoke"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`撤銷「${connection.name}」？`}
        description="撤銷後它立刻無法讀取或記帳。它之前記的紀錄會保留，並仍標示是透過它記錄的。"
        confirmLabel="撤銷"
        variant="destructive"
        loading={revoking}
        onConfirm={doRevoke}
      />
    </div>
  );
}
