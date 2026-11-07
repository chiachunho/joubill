"use client";

import { use, useState } from "react";
import { Coins, Download, GitMerge, History, Pencil, Plus, Trash2 } from "lucide-react";

import { Avatar } from "@/components/mini/Avatar";
import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { DeleteGroupRow } from "@/components/mini/DeleteGroupRow";
import { AddMemberDialog } from "@/components/mini/AddMemberDialog";
import { MergeMemberDialog } from "@/components/mini/MergeMemberDialog";
import { NavRow } from "@/components/mini/NavRow";
import { MemberNameDialog } from "@/components/mini/MemberNameDialog";
import { GroupSettingsSkeleton } from "@/components/mini/skeletons";
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
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Member | null>(null);
  const [mergeTarget, setMergeTarget] = useState<Member | null>(null);

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
