"use client";

import Link from "next/link";
import { Bell, ChevronRight } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import {
  useGetGroupNotificationsQuery,
  useGetPushSubscriptionsQuery,
  useUpdateGroupNotificationsMutation,
} from "@/store/api";

/**
 * 群組設定 → the push switch (issue #67): mute push for this one group. Personal, like the rest of
 * push: other members, the group's chat message and the activity feed are unaffected. Web App only
 * (`Platform.GroupNotificationSetting`); hidden when the server has no push. Returns rows for the
 * settings card, which owns the dividers.
 */
export function GroupNotificationSetting({ groupId }: { groupId: number }) {
  const { data: push } = useGetPushSubscriptionsQuery();
  const { data } = useGetGroupNotificationsQuery(groupId);
  const [update, { isError }] = useUpdateGroupNotificationsMutation();

  if (!push?.configured || !data) return null;

  if (push.count === 0) {
    return (
      <Link
        href="/app/settings"
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 active:bg-accent/50"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bell className="size-3.5" />
        </span>
        <p className="min-w-0 flex-1 text-sm">先到個人設定開通知</p>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" />
      </Link>
    );
  }

  return (
    <>
      <label className="flex items-center gap-3 px-4 py-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bell className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm">推播這個群組的紀錄</p>
          <p className="text-xs text-muted-foreground">只影響你自己</p>
        </div>
        <Switch
          aria-label="推播這個群組的紀錄"
          checked={!data.muted}
          onCheckedChange={(on) => void update({ groupId, muted: !on })}
        />
      </label>
      {(isError || data.telegramLinked) && (
        <div className="space-y-1 px-4 py-2.5 text-xs">
          {isError && <p className="text-destructive">沒有存成功，請再試一次。</p>}
          {data.telegramLinked && (
            <p className="text-muted-foreground">
              這個群組已連結
              Telegram，群組訊息本身就會提醒你。不想同一件事收到兩次，可以在這裡關掉。
            </p>
          )}
        </div>
      )}
    </>
  );
}
