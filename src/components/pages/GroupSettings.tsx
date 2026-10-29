"use client";

import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowRightLeft,
  BookOpen,
  ChevronRight,
  Coins,
  History,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import useSWR from "swr";

import { Avatar } from "@/components/mini/Avatar";
import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { DangerZoneSection } from "@/components/mini/DangerZoneSection";
import { MemberNameDialog } from "@/components/mini/MemberNameDialog";
import { GroupSettingsSkeleton } from "@/components/mini/skeletons";
import type { Platform } from "@/components/pages/platform";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { labelMember, labelUser } from "@/lib/label";
import { SUPPORTED_CURRENCIES } from "@/lib/zod";

type Member = {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  status: string;
  /** Has a name but no account (added from the member list). */
  isPlaceholder: boolean;
};

type MembersResponse = { members: Member[] };
type SettingsResponse = { defaultCurrency: string };
type AvatarsResponse = { groupPhoto: string | null; userPhotos: Record<number, string | null> };
type MeResponse = { userId: number };

export function GroupSettings({
  params,
  platform,
}: {
  params: Promise<{ id: string }>;
  platform: Platform;
}) {
  const { id } = use(params);

  const backHref = `${platform.basePath}/groups/${id}`;
  platform.useBack(backHref);

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
  const [addOpen, setAddOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Member | null>(null);
  const [currencyPending, setCurrencyPending] = useState(false);
  const [pendingCurrency, setPendingCurrency] = useState<string | null>(null);

  async function toggleStatus(member: Member) {
    if (togglingId !== null) return;
    const newStatus = member.status === "active" ? "inactive" : "active";
    setTogglingId(member.id);
    setToggleError(null);

    mutateMembers(
      (prev) =>
        prev
          ? {
              members: prev.members.map((m) =>
                m.id === member.id ? { ...m, status: newStatus } : m,
              ),
            }
          : prev,
      { revalidate: false },
    );

    try {
      await platform.request(`/api/groups/${id}/members/${member.id}`, {
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

  /** Resolves to an error message for the dialog, or null once saved. */
  async function submitMemberName(
    path: string,
    method: "POST" | "PATCH",
    name: string,
  ): Promise<string | null> {
    const res = await platform.rawRequest(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: name }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return data.error ?? "儲存失敗，請再試一次";
    }
    await mutateMembers();
    return null;
  }

  async function doDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteLoading(true);

    try {
      const res = await platform.rawRequest(`/api/groups/${id}/members/${target.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          setDeleteError(
            `無法刪除：此成員有 ${(data as { expenseCount?: number }).expenseCount ?? "多筆"} 筆費用記錄，只能停用。`,
          );
        } else {
          setDeleteError("刪除失敗，請再試一次");
        }
        return;
      }

      await mutateMembers();
      setDeleteTarget(null);
    } catch {
      setDeleteError("刪除失敗，請再試一次");
    } finally {
      setDeleteLoading(false);
    }
  }

  async function updateCurrency(currency: string) {
    if (currencyPending) return;
    setCurrencyPending(true);

    mutateSettings((prev) => (prev ? { ...prev, defaultCurrency: currency } : prev), {
      revalidate: false,
    });

    try {
      await platform.request(`/api/groups/${id}/settings`, {
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
        <platform.BackLink href={backHref} />
        <h1 className="text-lg font-semibold">群組設定</h1>
      </div>

      {/* 貨幣與匯率 — 預設貨幣 stays inline (single control, no reason to
          leave the page); 自訂匯率 has its own forms/list heavy enough that
          it moved to its own sub-page, see docs/design-system.md §6. */}
      <section className="px-4">
        <p className="sect mb-2.5">貨幣與匯率</p>
        <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Coins className="size-3.5 text-primary" />
            </div>
            <span className="flex-1 text-sm">預設貨幣</span>
            <Select
              value={settings.defaultCurrency}
              onValueChange={(c) => {
                if (c !== settings.defaultCurrency) setPendingCurrency(c);
              }}
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
          <Link
            href={`${platform.basePath}/groups/${id}/settings/rates`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 active:bg-accent/50"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ArrowRightLeft className="size-3.5" />
            </span>
            <p className="min-w-0 flex-1 text-sm">自訂匯率</p>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" />
          </Link>
        </div>
      </section>

      {/* 動態紀錄 — the way into the audit log. The group page header has no
          free slot (personal settings left, group settings right) and the
          Expenses row is taken by 還款/支出, so the entry lives here; the
          record forms' "最後由 X 修改" line is the shortcut from a record. */}
      <section className="px-4">
        <div className="overflow-hidden rounded-2xl bg-secondary/50">
          <Link
            href={`${platform.basePath}/groups/${id}/activity`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 active:bg-accent/50"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <History className="size-3.5" />
            </span>
            <p className="min-w-0 flex-1 text-sm">動態紀錄</p>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" />
          </Link>
        </div>
      </section>

      {/* Beancount 複製 — 帳戶名稱設定 has its own form fields (3 prefixes +
          per-member accounts), so it's a nav row into its own sub-page too. */}
      <section className="px-4">
        <p className="sect mb-2.5">Beancount 複製</p>
        <div className="overflow-hidden rounded-2xl bg-secondary/50">
          <Link
            href={`${platform.basePath}/groups/${id}/settings/beancount`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 active:bg-accent/50"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <BookOpen className="size-3.5" />
            </span>
            <p className="min-w-0 flex-1 text-sm">帳戶名稱設定</p>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" />
          </Link>
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
              {
                userId: member.id,
                firstName: member.firstName,
                lastName: member.lastName,
                username: member.username,
              },
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
                    {member.isPlaceholder && (
                      <span className="ml-1.5 rounded-lg bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        無帳號
                      </span>
                    )}
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
                  {member.isPlaceholder && (
                    <button
                      onClick={() => setRenameTarget(member)}
                      disabled={isToggling}
                      aria-label="改名"
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-30"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  )}
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
          <button
            onClick={() => setAddOpen(true)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-primary transition-colors hover:bg-secondary"
          >
            <Plus className="size-4" />
            新增成員（不需帳號）
          </button>
        </div>
      </section>

      {toggleError && (
        <div className="mx-4 rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {toggleError}
          <button
            onClick={() => setToggleError(null)}
            className="ml-2 text-xs underline opacity-70"
          >
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

      <DangerZoneSection
        groupId={id}
        membersCount={membersData.members.length}
        selfUserId={selfUserId}
        rawFetch={platform.rawRequest}
        redirectPath={platform.basePath}
      />

      <MemberNameDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="新增成員"
        description="沒有帳號的成員也能當付款人或分攤者。"
        confirmLabel="新增"
        onSubmit={async (name) => {
          const err = await submitMemberName(`/api/groups/${id}/members/placeholder`, "POST", name);
          if (!err) setAddOpen(false);
          return err;
        }}
      />

      <MemberNameDialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        title="改名"
        initialName={renameTarget?.firstName ?? ""}
        confirmLabel="儲存"
        onSubmit={async (name) => {
          if (!renameTarget) return null;
          const err = await submitMemberName(
            `/api/groups/${id}/members/${renameTarget.id}`,
            "PATCH",
            name,
          );
          if (!err) setRenameTarget(null);
          return err;
        }}
      />

      <ConfirmDialog
        open={pendingCurrency !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCurrency(null);
        }}
        title="變更預設貨幣"
        description={
          pendingCurrency
            ? `整本帳會改以 ${pendingCurrency} 計算：餘額與統計將以市場匯率重新換算，現有的群組自訂匯率與單筆自訂匯率會暫停生效（改回原貨幣時恢復）。`
            : undefined
        }
        confirmLabel="變更"
        loading={currencyPending}
        onConfirm={async () => {
          if (!pendingCurrency) return;
          await updateCurrency(pendingCurrency);
          setPendingCurrency(null);
        }}
      />

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
    </div>
  );
}
