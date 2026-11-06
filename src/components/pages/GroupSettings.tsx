"use client";

import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowRightLeft,
  BookOpen,
  ChevronRight,
  Clock,
  Coins,
  Download,
  GitMerge,
  History,
  Send,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { Avatar } from "@/components/mini/Avatar";
import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { DangerZoneSection } from "@/components/mini/DangerZoneSection";
import { TimeZoneSelect } from "@/components/mini/TimeZoneSelect";
import { TelegramChatSection } from "@/components/mini/TelegramChatSection";
import { AddMemberDialog } from "@/components/mini/AddMemberDialog";
import { MergeMemberDialog } from "@/components/mini/MergeMemberDialog";
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
import { activityFeedHref } from "@/lib/activity-link";
import type { MembersResponse } from "@/lib/api-types";
import { apiErrorStatus, apiErrorText, describeError } from "@/lib/api-error";
import { saveResponseAsFile } from "@/lib/download";
import { labelMember, labelUser } from "@/lib/label";
import { TIMEZONE_PURPOSE } from "@/lib/timezone";
import { SUPPORTED_CURRENCIES } from "@/lib/zod";
import {
  useGetAvatarsQuery,
  useGetMeQuery,
  useGetMembersQuery,
  useGetSettingsQuery,
  useRemoveMemberMutation,
  useRenameMemberMutation,
  useUpdateGroupCurrencyMutation,
  useUpdateGroupTimezoneMutation,
  useUpdateMemberStatusMutation,
} from "@/store/api";

type Member = MembersResponse["members"][number];

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

  const { data: me } = useGetMeQuery();
  const selfUserId = me?.userId;

  const { data: membersData, error: membersError } = useGetMembersQuery(id);
  const { data: settings, error: settingsError } = useGetSettingsQuery(id);
  const { data: avatars } = useGetAvatarsQuery(id);

  const [renameMember] = useRenameMemberMutation();
  const [removeMember] = useRemoveMemberMutation();
  const [updateMemberStatus] = useUpdateMemberStatusMutation();
  const [updateGroupCurrency] = useUpdateGroupCurrencyMutation();
  const [updateGroupTimezone] = useUpdateGroupTimezoneMutation();

  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Member | null>(null);
  const [mergeTarget, setMergeTarget] = useState<Member | null>(null);
  const [currencyPending, setCurrencyPending] = useState(false);
  const [pendingCurrency, setPendingCurrency] = useState<string | null>(null);
  const [timezonePending, setTimezonePending] = useState(false);
  const [pendingTimezone, setPendingTimezone] = useState<string | null>(null);
  const [exportPending, setExportPending] = useState<"download" | "send" | null>(null);
  const [exportMessage, setExportMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function toggleStatus(member: Member) {
    if (togglingId !== null) return;
    const newStatus = member.status === "active" ? "inactive" : "active";
    setTogglingId(member.id);
    setToggleError(null);

    try {
      // The row flips at once; the mutation puts it back if the server refuses.
      await updateMemberStatus({ groupId: id, userId: member.id, status: newStatus }).unwrap();
    } catch {
      setToggleError("更新失敗，請再試一次");
    } finally {
      setTogglingId(null);
    }
  }

  /** Resolves to an error message for the dialog, or null once saved. */
  async function submitRename(target: { userId: number }, name: string): Promise<string | null> {
    try {
      await renameMember({ groupId: id, userId: target.userId, firstName: name }).unwrap();
      return null;
    } catch (e) {
      return apiErrorText(e, "儲存失敗，請再試一次");
    }
  }

  async function doDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteLoading(true);

    try {
      await removeMember({ groupId: id, userId: target.id }).unwrap();
      setDeleteTarget(null);
    } catch (e) {
      if (apiErrorStatus(e) === 409) {
        const count = (e as { data?: { expenseCount?: number } }).data?.expenseCount;
        setDeleteError(`無法刪除：此成員有 ${count ?? "多筆"} 筆費用記錄，只能停用。`);
      } else {
        setDeleteError("刪除失敗，請再試一次");
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  async function exportCsv(mode: "download" | "send") {
    if (exportPending) return;
    setExportPending(mode);
    setExportMessage(null);
    try {
      if (mode === "send") {
        const res = await platform.rawRequest(`/api/groups/${id}/export/send`, { method: "POST" });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setExportMessage({ ok: false, text: data.error ?? "匯出失敗，請再試一次" });
          return;
        }
        setExportMessage({ ok: true, text: "已傳送到群組" });
        return;
      }
      const res = await platform.rawRequest(`/api/groups/${id}/export?format=csv`);
      if (!res.ok) {
        setExportMessage({ ok: false, text: "匯出失敗，請再試一次" });
        return;
      }
      await saveResponseAsFile(res, "export.csv");
    } catch {
      setExportMessage({ ok: false, text: "匯出失敗，請再試一次" });
    } finally {
      setExportPending(null);
    }
  }

  async function updateCurrency(currency: string) {
    if (currencyPending) return;
    setCurrencyPending(true);
    try {
      // The select shows the new currency at once; the mutation puts it back on failure.
      await updateGroupCurrency({ groupId: id, defaultCurrency: currency }).unwrap();
    } catch {
      // rolled back
    } finally {
      setCurrencyPending(false);
    }
  }

  async function updateTimezone(timezone: string) {
    if (timezonePending) return;
    setTimezonePending(true);
    try {
      // The select shows the new zone at once; the mutation puts it back on failure.
      await updateGroupTimezone({ groupId: id, timezone }).unwrap();
    } catch {
      // rolled back
    } finally {
      setTimezonePending(false);
    }
  }

  const error = membersError ?? settingsError;
  if (error) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{describeError(error)}</p>
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
          <div className="space-y-2 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Clock className="size-3.5 text-primary" />
              </div>
              <span className="flex-1 text-sm">時區</span>
              <div className="w-56 max-w-[60%]">
                <TimeZoneSelect
                  value={settings.timezone}
                  disabled={timezonePending}
                  onChange={(tz) => {
                    if (tz !== settings.timezone) setPendingTimezone(tz);
                  }}
                />
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{TIMEZONE_PURPOSE}</p>
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

      <platform.GroupNotificationSetting groupId={Number(id)} />

      {/* 動態紀錄 — the way into the audit log. The group page header has no
          free slot (personal settings left, group settings right) and the
          Expenses row is taken by 還款/支出, so the entry lives here; the
          record forms' "最後由 X 修改" line is the shortcut from a record. */}
      <section className="px-4">
        <div className="overflow-hidden rounded-2xl bg-secondary/50">
          <Link
            href={activityFeedHref({ appBase: platform.basePath, groupId: id })}
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

      {/* Beancount — a personal ledger export, so it stays apart from the group's CSV:
          its accounts and its export (range, watermark) each get a sub-page. */}
      <section className="px-4">
        <p className="sect mb-2.5">Beancount</p>
        <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
          <Link
            href={`${platform.basePath}/groups/${id}/settings/beancount`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 active:bg-accent/50"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <BookOpen className="size-3.5" />
            </span>
            <p className="min-w-0 flex-1 text-sm">帳戶設定</p>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" />
          </Link>
          <Link
            href={`${platform.basePath}/groups/${id}/settings/beancount/export`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 active:bg-accent/50"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Download className="size-3.5" />
            </span>
            <p className="min-w-0 flex-1 text-sm">匯出 beancount</p>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" />
          </Link>
        </div>
      </section>

      {/* 匯出 — one CSV of every record. The Web App can save it directly; Telegram's
          webview can't take an authenticated download, so both apps can also have the
          bot post the file in the group chat (the same file /export sends). */}
      <section className="px-4">
        <p className="sect mb-2.5">匯出</p>
        <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
          {platform.canDownloadExport && (
            <button
              onClick={() => exportCsv("download")}
              disabled={exportPending !== null}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30 active:bg-accent/50 disabled:opacity-50"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Download className="size-3.5" />
              </span>
              <p className="min-w-0 flex-1 text-sm">
                {exportPending === "download" ? "匯出中…" : "下載 CSV"}
              </p>
            </button>
          )}
          <button
            onClick={() => exportCsv("send")}
            disabled={exportPending !== null}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30 active:bg-accent/50 disabled:opacity-50"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Send className="size-3.5" />
            </span>
            <p className="min-w-0 flex-1 text-sm">
              {exportPending === "send" ? "傳送中…" : "匯出 CSV 到群組"}
            </p>
          </button>
        </div>
        {exportMessage && (
          <p
            className={`mt-2 px-1 text-xs ${exportMessage.ok ? "text-muted-foreground" : "text-destructive"}`}
          >
            {exportMessage.text}
          </p>
        )}
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
                displayName: member.displayName,
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
                      onClick={() => setMergeTarget(member)}
                      disabled={isToggling}
                      aria-label="合併到…"
                      className="rounded-lg p-1.5 text-primary transition-colors hover:bg-primary/10 disabled:opacity-30"
                    >
                      <GitMerge className="size-3.5" />
                    </button>
                  )}
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
            新增成員
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

      <TelegramChatSection groupId={id} />

      <DangerZoneSection
        groupId={id}
        membersCount={membersData.members.filter((m) => !m.isPlaceholder).length}
        selfUserId={selfUserId}
        redirectPath={platform.basePath}
      />

      <AddMemberDialog
        groupId={id}
        open={addOpen}
        onOpenChange={setAddOpen}
        inviteHint={platform.inviteHint}
      />
      <MergeMemberDialog
        groupId={id}
        placeholder={mergeTarget}
        members={membersData.members}
        selfUserId={selfUserId}
        photos={avatars?.userPhotos}
        onOpenChange={(open) => !open && setMergeTarget(null)}
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
          const err = await submitRename({ userId: renameTarget.id }, name);
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
        open={pendingTimezone !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTimezone(null);
        }}
        title="變更群組時區"
        description={
          pendingTimezone
            ? `要把群組時區改成 ${pendingTimezone} 嗎？這會影響整個群組：bot 記帳的日期，以及匯率使用的日期。已經記下的紀錄日期不會改變。`
            : undefined
        }
        confirmLabel="變更"
        loading={timezonePending}
        onConfirm={async () => {
          if (!pendingTimezone) return;
          await updateTimezone(pendingTimezone);
          setPendingTimezone(null);
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
