"use client";

import { use, useCallback } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { BeancountSettingsSection } from "@/components/mini/BeancountSettingsSection";
import { SettingsSubpageSkeleton } from "@/components/mini/skeletons";
import { tmaRawFetch } from "@/lib/web-fetch";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";

type Member = {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  status: string;
};

type MembersResponse = { members: Member[] };

export default function GroupBeancountSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const back = useCallback(() => router.push(`/mini/groups/${id}/settings`), [router, id]);
  useTelegramBackButton(back);

  const { data: membersData, error } = useSWR<MembersResponse>(`/api/groups/${id}/members`);

  if (error) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{String(error)}</p>
      </div>
    );
  }

  if (!membersData) {
    return <SettingsSubpageSkeleton />;
  }

  return (
    <div className="space-y-6 py-4">
      <div className="px-4">
        <h1 className="text-lg font-semibold">Beancount 帳戶名稱設定</h1>
      </div>

      <BeancountSettingsSection groupId={id} members={membersData.members} rawFetch={tmaRawFetch} />
    </div>
  );
}
