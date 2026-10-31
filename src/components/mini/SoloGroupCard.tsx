"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import { AddMemberDialog } from "@/components/mini/AddMemberDialog";

/**
 * Shown on the group page while the viewer is the only member, in place of the
 * "all settled" banner. One 新增成員 button opens the same choice as 群組設定's member
 * list (`AddMemberDialog`), so the card stays small. It has no dismiss: it goes away
 * when a second member exists.
 */
export function SoloGroupCard({
  groupId,
  basePath,
  inviteHint,
}: {
  groupId: string;
  basePath: string;
  inviteHint: string;
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <section className="mx-4 rounded-2xl bg-secondary/50 p-4">
      <h2 className="text-sm font-semibold">還沒有其他成員</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        邀請朋友一起分帳，或先幫沒有帳號的人建立名字
      </p>

      <button
        onClick={() => setAddOpen(true)}
        className="mt-3.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus className="size-4" />
        新增成員
      </button>

      <Link
        href={`${basePath}/groups/${groupId}/settings`}
        className="mt-3.5 block border-t border-border/40 pt-3 text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        到群組設定管理成員 →
      </Link>

      <AddMemberDialog
        groupId={groupId}
        open={addOpen}
        onOpenChange={setAddOpen}
        inviteHint={inviteHint}
      />
    </section>
  );
}
