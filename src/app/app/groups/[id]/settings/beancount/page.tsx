"use client";

import { use } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import useSWR from "swr";

import { BeancountSettingsSection } from "@/components/mini/BeancountSettingsSection";
import { BeancountSettingsSkeleton } from "@/components/mini/skeletons";
import { webRawFetch } from "@/lib/web-fetch";

type Member = {
  id: number;
  firstName: string | null;
  lastName?: string | null;
  username: string | null;
};

type MembersResponse = { members: Member[] };

export default function AppBeancountSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: membersData, error } = useSWR<MembersResponse>(`/api/groups/${id}/members`);

  return (
    <div className="space-y-6 py-4">
      <div className="relative flex items-center justify-center px-4 py-1">
        <Link
          href={`/app/groups/${id}/settings`}
          className="absolute left-4 inline-flex items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          返回
        </Link>
        <h1 className="text-sm font-semibold">Beancount 複製</h1>
      </div>

      {error ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm text-muted-foreground">無法載入</p>
        </div>
      ) : !membersData ? (
        <BeancountSettingsSkeleton />
      ) : (
        <BeancountSettingsSection groupId={id} members={membersData.members} rawFetch={webRawFetch} />
      )}
    </div>
  );
}
