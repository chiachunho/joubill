"use client";

import { InviteActions } from "@/components/mini/InviteActions";

/** 群組設定的「邀請成員」: the live invite code and link, with copy / share / reset. */
export function InviteSection({ groupId }: { groupId: string }) {
  return (
    <section className="px-4">
      <p className="sect mb-2.5">邀請成員</p>
      <InviteActions groupId={groupId} />
    </section>
  );
}
