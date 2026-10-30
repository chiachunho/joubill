"use client";

import { useState } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";

import { AddPlaceholderDialog } from "@/components/mini/AddPlaceholderDialog";
import { InviteActions } from "@/components/mini/InviteActions";

/**
 * Shown on the group page while the viewer is the only member, in place of the
 * "all settled" banner: both ways to add people without a trip to 群組設定.
 * It has no dismiss: it goes away when a second member exists.
 */
export function SoloGroupCard({ groupId, basePath }: { groupId: string; basePath: string }) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <section className="mx-4 rounded-2xl bg-secondary/50 p-4">
      <h2 className="text-sm font-semibold">還沒有其他成員</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        邀請朋友一起分帳，或先幫沒有帳號的人建立名字
      </p>

      <div className="mt-4">
        <p className="sect mb-2">邀請成員</p>
        <InviteActions
          groupId={groupId}
          allowReset={false}
          className="overflow-hidden rounded-lg border border-border/40"
          hint="對方點連結可能會在外部瀏覽器開啟。也可以把邀請碼傳給對方，請他在 Mini App 的「輸入邀請碼」貼上。"
        />
      </div>

      <div className="mt-4">
        <p className="sect mb-2">新增成員</p>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex w-full items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
        >
          <UserPlus className="size-4" />
          新增沒有帳號的成員
        </button>
      </div>

      <Link
        href={`${basePath}/groups/${groupId}/settings`}
        className="mt-4 block border-t border-border/40 pt-3 text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        到群組設定管理成員與邀請碼 →
      </Link>

      <AddPlaceholderDialog groupId={groupId} open={addOpen} onOpenChange={setAddOpen} />
    </section>
  );
}
