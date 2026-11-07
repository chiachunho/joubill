"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2 } from "lucide-react";

import {
  AppAccessPicker,
  AppScopePicker,
  scopeIsValid,
  type Scope,
} from "@/components/mini/AppFormFields";
import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { connectionStatus } from "@/lib/mcp-connection-input";
import { expiryLabel, lastUsedLabel, sameScope } from "@/lib/app-ui";
import { apiErrorText } from "@/lib/api-error";
import type { McpConnectionItem } from "@/lib/api-types";
import { useRevokeMcpConnectionMutation, useUpdateMcpConnectionMutation } from "@/store/api";

/**
 * One connection: change its permission and group scope, or revoke it. The name and the
 * expiry are shown but not editable (the audit log quotes the name, and a longer expiry is a
 * new token). Widening to 可記帳 asks first; narrowing saves straight away.
 *
 * The parent mounts this with `key={connection.id}`, so the fields start from the saved values.
 */
export function McpConnectionDialog({
  connection,
  groups,
  callsHref,
  onClose,
}: {
  connection: McpConnectionItem;
  /** 使用紀錄 for this connection; the page knows which app it is in. */
  callsHref: string;
  groups: { id: number; title: string; defaultCurrency: string }[];
  onClose: () => void;
}) {
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
      onClose();
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
      onClose();
    } catch (e) {
      setError(apiErrorText(e, "撤銷失敗"));
    } finally {
      setConfirm(null);
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !saving && !revoking && onClose()}>
        <DialogContent className="max-h-[90dvh] max-w-sm overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{connection.name}</DialogTitle>
            <DialogDescription>
              {connection.kind === "oauth"
                ? "OAuth 連線"
                : `個人存取權杖 ${connection.tokenPrefix}…`}
              {" · "}
              {lastUsedLabel(connection.lastUsedAt)}
              {" · "}
              {expired ? "已到期" : expiryLabel(connection.expiresAt)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Link
              href={callsHref}
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
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
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
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </>
  );
}
