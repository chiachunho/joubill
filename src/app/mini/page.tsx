"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type MyGroupsResponse = {
  groups: Array<{ id: number; title: string; defaultCurrency: string }>;
  activeGroupId: number | null;
};

export default function MiniHome() {
  const router = useRouter();
  const { data, error } = useSWR<MyGroupsResponse>("/api/me/groups");

  useEffect(() => {
    if (data?.activeGroupId) {
      router.replace(`/mini/groups/${data.activeGroupId}`);
    }
  }, [data, router]);

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>無法載入</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{String(error)}</CardContent>
      </Card>
    );
  }
  if (!data) {
    return <p className="text-muted-foreground">載入中…</p>;
  }
  if (data.activeGroupId) {
    return null;
  }

  const { groups } = data;
  if (groups.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>還沒有任何群組</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          把 Bot 加進一個 Telegram 群組，輸入 /start 即可註冊。
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold">我的群組</h1>
      <div className="flex flex-col gap-3">
        {groups.map((g) => (
          <Link key={g.id} href={`/mini/groups/${g.id}`}>
            <Card className="transition hover:bg-accent">
              <CardHeader>
                <CardTitle className="text-base">{g.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                預設幣別 {g.defaultCurrency}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
