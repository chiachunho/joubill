"use client";

import { use, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Coins, Trash2 } from "lucide-react";
import useSWR from "swr";

import { Avatar } from "@/components/mini/Avatar";
import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { GroupSettingsSkeleton } from "@/components/mini/skeletons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { labelMember, labelUser } from "@/lib/label";
import { tmaFetch } from "@/lib/tma-fetch";
import { tmaRawFetch } from "@/lib/web-fetch";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";
import { SUPPORTED_CURRENCIES } from "@/lib/zod";

type Member = {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  status: string;
};

type MembersResponse = { members: Member[] };
type SettingsResponse = { defaultCurrency: string };
type AvatarsResponse = { groupPhoto: string | null; userPhotos: Record<number, string | null> };
type MeResponse = { userId: number };

export default function GroupSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const back = useCallback(() => router.push(`/mini/groups/${id}`), [router, id]);
  useTelegramBackButton(back);

  const { data: me } = useSWR<MeResponse>("/api/me/groups");
  const selfUserId = me?.userId;

  const {
    data: membersData,
    error: membersError,
    mutate: mutateMembers,
  } = useSWR<MembersResponse>(`/api/groups/${id}/members`);

  const {
    data: settings,
    error: settingsError,
    mutate: mutateSettings,
  } = useSWR<SettingsResponse>(`/api/groups/${id}/settings`);

  const { data: avatars } = useSWR<AvatarsResponse>(`/api/groups/${id}/avatars`);

  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [currencyPending, setCurrencyPending] = useState(false);
  const [deleteGroupOpen, setDeleteGroupOpen] = useState(false);
  const [deleteGroupLoading, setDeleteGroupLoading] = useState(false);
  const [deleteGroupError, setDeleteGroupError] = useState<string | null>(null);

  async function toggleStatus(member: Member) {
    if (togglingId !== null) return;
    const newStatus = member.status === "active" ? "inactive" : "active";
    setTogglingId(member.id);
    setToggleError(null);

    mutateMembers(
      (prev) =>
        prev
          ? { members: prev.members.map((m) => (m.id === member.id ? { ...m, status: newStatus } : m)) }
          : prev,
      { revalidate: false },
    );

    try {
      await tmaFetch(`/api/groups/${id}/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch {
      setToggleError("更新失敗，請再試一次");
      await mutateMembers();
    } finally {
      setTogglingId(null);
    }
  }

  async function doDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteLoading(true);

    try {
      const res = await tmaRawFetch(`/api/groups/${id}/members/${target.id}`, { method: "DELETE" });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          setDeleteError(`無法刪除：此成員有 ${(data as { expenseCount?: number }).expenseCount ?? "多筆"} 筆費用記錄，只能停用。`);
        } else {
          setDeleteError("刪除失敗，請再試一次");
        }
        return; // keep dialog open so user can see the error
      }

      await mutateMembers();
      setDeleteTarget(null);
    } catch {
      setDeleteError("刪除失敗，請再試一次");
    } finally {
      setDeleteLoading(false);
    }
  }

  async function doDeleteGroup() {
    setDeleteGroupLoading(true);
    setDeleteGroupError(null);

    try {
      const res = await tmaRawFetch(`/api/groups/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setDeleteGroupError("刪除失敗，請再試一次");
        return;
      }
      router.replace("/mini");
    } catch {
      setDeleteGroupError("刪除失敗，請再試一次");
    } finally {
      setDeleteGroupLoading(false);
    }
  }

  async function updateCurrency(currency: string) {
    if (currencyPending) return;
    setCurrencyPending(true);

    mutateSettings((prev) => (prev ? { ...prev, defaultCurrency: currency } : prev), {
      revalidate: false,
    });

    try {
      await tmaFetch(`/api/groups/${id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultCurrency: currency }),
      });
    } catch {
      await mutateSettings();
    } finally {
      setCurrencyPending(false);
    }
  }

  const error = membersError ?? settingsError;
  if (error) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{String(error)}</p>
      </div>
    );
  }

  if (!membersData || !settings) {
    return <GroupSettingsSkeleton />;
  }

  const sortedMembers = membersData.members.toSorted((a, b) =>
    a.status === b.status ? 0 : a.status === "active" ? -1 : 1,
  );

  return (
    <div className="space-y-6 py-4">
      {/* Header */}
      <div className="px-4">
        <h1 className="text-lg font-semibold">群組設定</h1>
      </div>

      {/* 一般 */}
      <section className="px-4">
        <p className="sect mb-2.5">一般</p>
        <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Coins className="size-3.5 text-primary" />
            </div>
            <span className="flex-1 text-sm">預設貨幣</span>
            <Select
              value={settings.defaultCurrency}
              onValueChange={updateCurrency}
              disabled={currencyPending}
            >
              <SelectTrigger className="h-8 w-24 rounded-lg border-0 bg-background/60 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {/* 成員 */}
      <section className="px-4">
        <p className="sect mb-2.5">成員 ({membersData.members.length})</p>
        <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
          {sortedMembers.map((member) => {
            const photo = avatars?.userPhotos[member.id] ?? null;
            const isInactive = member.status === "inactive";
            const isToggling = togglingId === member.id;
            const label = labelUser(
              { userId: member.id, firstName: member.firstName, lastName: member.lastName, username: member.username },
              selfUserId,
            );

            return (
              <div key={member.id} className="flex items-center gap-3 px-4 py-3">
                <div className={isInactive ? "opacity-40" : undefined}>
                  <Avatar src={photo} name={label} userId={member.id} size="sm" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm ${isInactive ? "text-muted-foreground" : ""}`}>
                    {label}
                  </p>
                  {isInactive && <p className="text-xs text-muted-foreground">已停用</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => toggleStatus(member)}
                    disabled={isToggling}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                      isInactive
                        ? "bg-secondary text-muted-foreground hover:bg-muted"
                        : "bg-primary/10 text-primary hover:bg-primary/20"
                    }`}
                  >
                    {isInactive ? "停用中" : "啟用中"}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(member)}
                    disabled={isToggling}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {toggleError && (
        <div className="mx-4 rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {toggleError}
          <button onClick={() => setToggleError(null)} className="ml-2 text-xs underline opacity-70">
            關閉
          </button>
        </div>
      )}

      {deleteError && (
        <div className="mx-4 rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {deleteError}
          <button
            onClick={() => setDeleteError(null)}
            className="ml-2 text-xs underline opacity-70"
          >
            關閉
          </button>
        </div>
      )}

      {/* 危險區域 */}
      <section className="px-4">
        <p className="sect mb-2.5">危險區域</p>
        <div className="overflow-hidden rounded-2xl bg-secondary/50">
          <button
            onClick={() => setDeleteGroupOpen(true)}
            className="flex w-full items-center gap-3 px-4 py-3 text-destructive transition-colors hover:bg-destructive/10"
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <Trash2 className="size-3.5 text-destructive" />
            </div>
            <span className="text-sm font-medium">刪除群組</span>
          </button>
        </div>
        {deleteGroupError && (
          <p className="mt-2 text-xs text-destructive">{deleteGroupError}</p>
        )}
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="刪除成員"
        description={
          deleteTarget
            ? `確定要將「${labelMember(deleteTarget)}」從群組移除嗎？此動作無法復原。`
            : undefined
        }
        confirmLabel="刪除"
        variant="destructive"
        loading={deleteLoading}
        onConfirm={doDelete}
      />

      <ConfirmDialog
        open={deleteGroupOpen}
        onOpenChange={(open) => {
          if (!open) setDeleteGroupOpen(false);
        }}
        title="刪除群組"
        description="確定要刪除此群組嗎？所有費用、結算紀錄將永久刪除，此動作無法復原。"
        confirmLabel="刪除"
        variant="destructive"
        loading={deleteGroupLoading}
        onConfirm={doDeleteGroup}
      />
    </div>
  );
}
