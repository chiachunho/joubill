"use client";

import { use, useState } from "react";
import { Coins, Download, History, MoreHorizontal, Plus } from "lucide-react";

import { Avatar } from "@/components/mini/Avatar";
import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { DeleteGroupRow } from "@/components/mini/DeleteGroupRow";
import { AddMemberDialog } from "@/components/mini/AddMemberDialog";
import { MergeMemberDialog } from "@/components/mini/MergeMemberDialog";
import { NavRow } from "@/components/mini/NavRow";
import { MemberNameDialog } from "@/components/mini/MemberNameDialog";
import { GroupSettingsSkeleton } from "@/components/mini/skeletons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Platform } from "@/components/pages/platform";
import { TelegramGlyph } from "@/components/TelegramIcon";
import { activityFeedHref } from "@/lib/activity-link";
import type { MembersResponse } from "@/lib/api-types";
import { apiErrorStatus, apiErrorText, describeError } from "@/lib/api-error";
import { labelMember, labelUser } from "@/lib/label";
import {
  useGetAvatarsQuery,
  useGetMeQuery,
  useGetMembersQuery,
  useRemoveMemberMutation,
  useRenameMemberMutation,
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
  const { data: avatars } = useGetAvatarsQuery(id);

  const [renameMember] = useRenameMemberMutation();
  const [removeMember] = useRemoveMemberMutation();
  const [updateMemberStatus] = useUpdateMemberStatusMutation();

  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** Set when the server refused the removal because the member is on records: how many. */
  const [deleteBlocked, setDeleteBlocked] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Member | null>(null);
  const [mergeTarget, setMergeTarget] = useState<Member | null>(null);

  async function toggleStatus(member: Member) {
    if (togglingId !== null) return;
    const newStatus = member.status === "active" ? "inactive" : "active";
    setDeleteError(null);
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
        // Shown inside the dialog, which stays open and offers 改為暫停分帳 instead.
        const count = (e as { data?: { expenseCount?: number } }).data?.expenseCount;
        setDeleteBlocked(count ?? 0);
      } else {
        setDeleteTarget(null);
        setDeleteError("移出失敗，請再試一次");
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  const error = membersError;
  if (error) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{describeError(error)}</p>
      </div>
    );
  }

  if (!membersData) {
    return <GroupSettingsSkeleton />;
  }

  // Two groups instead of a status label: where a member sits says whether new expenses
  // count them in by default.
  const activeMembers = membersData.members.filter((m) => m.status !== "inactive");
  const pausedMembers = membersData.members.filter((m) => m.status === "inactive");

  function memberLabel(member: Member): string {
    return labelUser(
      {
        userId: member.id,
        displayName: member.displayName,
        firstName: member.firstName,
        lastName: member.lastName,
        username: member.username,
      },
      selfUserId,
    );
  }

  function memberRow(member: Member) {
    const label = memberLabel(member);
    const isPaused = member.status === "inactive";
    const busy = togglingId === member.id;
    return (
      <div key={member.id} className="flex items-center gap-3 px-4 py-3">
        <div className={isPaused ? "opacity-40" : undefined}>
          <Avatar
            src={avatars?.userPhotos[member.id] ?? null}
            name={label}
            userId={member.id}
            size="sm"
          />
        </div>
        <p className={`min-w-0 flex-1 truncate text-sm ${isPaused ? "text-muted-foreground" : ""}`}>
          {label}
          {member.isPlaceholder && (
            <span className="ml-1.5 rounded-lg bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
              無帳號
            </span>
          )}
        </p>
        {isPaused && (
          <button
            onClick={() => toggleStatus(member)}
            disabled={busy}
            className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
          >
            恢復
          </button>
        )}
        <MemberMenu
          label={label}
          disabled={busy}
          actions={[
            !isPaused && { label: "暫停分帳", onSelect: () => toggleStatus(member) },
            member.isPlaceholder && { label: "改名", onSelect: () => setRenameTarget(member) },
            member.isPlaceholder && {
              label: "合併到真人成員…",
              onSelect: () => setMergeTarget(member),
            },
            member.id !== selfUserId && {
              label: "移出群組",
              destructive: true,
              onSelect: () => {
                setDeleteBlocked(null);
                setDeleteError(null);
                setDeleteTarget(member);
              },
            },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      {/* Header */}
      <div className="px-4">
        <platform.BackLink href={backHref} />
        <h1 className="text-lg font-semibold">群組設定</h1>
      </div>

      {/* 成員 */}
      <section className="px-4">
        <p className="sect mb-2.5">一起分帳 ({activeMembers.length})</p>
        <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
          {activeMembers.map(memberRow)}
          <button
            onClick={() => setAddOpen(true)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-primary transition-colors hover:bg-secondary"
          >
            <Plus className="size-4" />
            新增成員
          </button>
        </div>
      </section>

      {pausedMembers.length > 0 && (
        <section className="px-4">
          <p className="sect mb-2.5">暫停分帳 ({pausedMembers.length})</p>
          <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/30">
            {pausedMembers.map(memberRow)}
          </div>
        </section>
      )}

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

      {/* One card for every single entry: no section titles. Telegram 群組, 貨幣與匯率 and 匯出 each hand a
          sub-topic to their own page (docs/design-system.md §6); 動態紀錄 is the way into the
          audit log (the group page header has no free slot, and the record forms' "最後由 X
          修改" line is the shortcut from a record). 刪除群組 stays last. */}
      <section className="px-4">
        <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
          <NavRow href={`${platform.basePath}/groups/${id}/settings/telegram`} icon={TelegramGlyph}>
            Telegram 群組
          </NavRow>
          <NavRow href={`${platform.basePath}/groups/${id}/settings/rates`} icon={Coins}>
            貨幣與匯率
          </NavRow>
          <platform.GroupNotificationSetting groupId={Number(id)} />
          <NavRow
            href={activityFeedHref({ appBase: platform.basePath, groupId: id })}
            icon={History}
          >
            動態紀錄
          </NavRow>
          <NavRow href={`${platform.basePath}/groups/${id}/settings/export`} icon={Download}>
            匯出
          </NavRow>
          <DeleteGroupRow
            groupId={id}
            membersCount={membersData.members.filter((m) => !m.isPlaceholder).length}
            selfUserId={selfUserId}
            redirectPath={platform.basePath}
          />
        </div>
      </section>

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
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteBlocked(null);
          }
        }}
        title={deleteTarget ? `移出${labelMember(deleteTarget)}？` : ""}
        description={
          deleteTarget ? (
            deleteBlocked !== null ? (
              <span className="block rounded-lg bg-destructive/10 px-3 py-2 text-destructive">
                {labelMember(deleteTarget)}還有{deleteBlocked > 0 ? ` ${deleteBlocked} 筆` : ""}
                紀錄，不能移出。
                {deleteTarget.status === "inactive"
                  ? "他已經暫停分帳了。"
                  : "可以改為暫停分帳，新支出就不會預設算他一份。"}
              </span>
            ) : (
              `確定要將「${labelMember(deleteTarget)}」移出群組嗎？此動作無法復原。`
            )
          ) : undefined
        }
        confirmLabel={
          deleteBlocked === null
            ? "移出"
            : deleteTarget?.status === "inactive"
              ? "知道了"
              : "改為暫停分帳"
        }
        variant={deleteBlocked === null ? "destructive" : "default"}
        loading={deleteLoading}
        onConfirm={async () => {
          if (deleteBlocked === null) return doDelete();
          const target = deleteTarget;
          setDeleteTarget(null);
          setDeleteBlocked(null);
          if (target && target.status !== "inactive") await toggleStatus(target);
        }}
      />
    </div>
  );
}

type MenuAction = { label: string; onSelect: () => void; destructive?: boolean };

/** The "⋯" on a member row: everything but 恢復, which sits in the row itself. */
function MemberMenu({
  label,
  disabled,
  actions,
}: {
  label: string;
  disabled: boolean;
  actions: (MenuAction | false | null | undefined)[];
}) {
  const [open, setOpen] = useState(false);
  const items = actions.filter((a): a is MenuAction => !!a);
  if (items.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={`${label} 的選項`}
          disabled={disabled}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-30"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        {items.map((a) => (
          <button
            key={a.label}
            onClick={() => {
              setOpen(false);
              a.onSelect();
            }}
            className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-secondary ${
              a.destructive ? "text-destructive" : ""
            }`}
          >
            {a.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
