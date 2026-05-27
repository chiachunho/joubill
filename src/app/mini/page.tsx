"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { tmaFetch } from "@/lib/tma-fetch";

type MyGroupsResponse = {
  groups: Array<{ id: number; title: string; defaultCurrency: string }>;
  activeGroupId: number | null;
};

export default function MiniHome() {
  const router = useRouter();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: MyGroupsResponse }
  >({ kind: "loading" });

  useEffect(() => {
    tmaFetch<MyGroupsResponse>("/api/me/groups")
      .then((data) => {
        if (data.activeGroupId) {
          router.replace(`/mini/groups/${data.activeGroupId}`);
          return;
        }
        setState({ kind: "ready", data });
      })
      .catch((err: Error) => setState({ kind: "error", message: err.message }));
  }, [router]);

  if (state.kind === "loading") {
    return <p className="text-muted-foreground">載入中…</p>;
  }
  if (state.kind === "error") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>無法載入</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{state.message}</CardContent>
      </Card>
    );
  }

  const { groups } = state.data;
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
