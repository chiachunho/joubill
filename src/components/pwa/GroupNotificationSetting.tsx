"use client";

import { Bell } from "lucide-react";

import { IconTile } from "@/components/mini/IconTile";
import { NavRow } from "@/components/mini/NavRow";
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
      <NavRow href="/app/settings" icon={Bell}>
        先到個人設定開通知
      </NavRow>
    );
  }

  const note = isError || data.telegramLinked;
  return (
    <label className={`flex gap-3 px-4 py-3 ${note ? "items-start" : "items-center"}`}>
      <IconTile icon={Bell} />
      <div className="min-w-0 flex-1">
        <p className="text-sm">推播這個群組的紀錄</p>
        <p className="text-xs text-muted-foreground">只影響你自己</p>
        {isError && <p className="mt-1.5 text-xs text-destructive">沒有存成功，請再試一次。</p>}
        {data.telegramLinked && (
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            這個群組已連結 Telegram，群組訊息本身就會提醒你。不想同一件事收到兩次，可以在這裡關掉。
          </p>
        )}
      </div>
      <Switch
        aria-label="推播這個群組的紀錄"
        className={note ? "mt-0.5" : undefined}
        checked={!data.muted}
        onCheckedChange={(on) => void update({ groupId, muted: !on })}
      />
    </label>
  );
}
