"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiErrorText } from "@/lib/api-error";
import { DISPLAY_NAME_MAX, graphemeLength, normaliseDisplayName } from "@/lib/profile";
import { useUpdateProfileMutation } from "@/store/api";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The current choice; null when the provider's name is in use. */
  current: string | null;
  /** The login provider's name, shown as the placeholder and the reset target. */
  providerName: string;
};

/**
 * 顯示名稱: the name everyone sees in every group, the chat cards included. Empty input goes back
 * to the provider's name, which then follows Telegram again. The rules are `normaliseDisplayName`,
 * checked here for instant feedback and again by the server.
 */
export function DisplayNameDialog({ open, onOpenChange, current, providerName }: Props) {
  const [name, setName] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [updateProfile, { isLoading }] = useUpdateProfileMutation();

  useEffect(() => {
    if (open) {
      setName(current ?? "");
      setError(null);
    }
  }, [open, current]);

  const check = normaliseDisplayName(name);
  const shown = error ?? (check.ok ? null : check.error);

  async function save(value: string) {
    const parsed = normaliseDisplayName(value);
    if (!parsed.ok || isLoading) return;
    setError(null);
    try {
      await updateProfile({ displayName: parsed.value }).unwrap();
      onOpenChange(false);
    } catch (e) {
      setError(apiErrorText(e, "儲存失敗，請再試一次"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={isLoading ? undefined : onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>顯示名稱</DialogTitle>
          <DialogDescription>
            所有群組、App 和機器人的訊息都會用這個名字。留空就用「{providerName}」。
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(name);
          }}
        >
          <div className="relative">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder={providerName}
              aria-label="顯示名稱"
              autoFocus
              disabled={isLoading}
              className="pr-14"
            />
            <span className="num pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              {graphemeLength(name.trim())}/{DISPLAY_NAME_MAX}
            </span>
          </div>
          {shown && <p className="mt-2 text-sm text-destructive">{shown}</p>}
        </form>
        <DialogFooter className="flex-row gap-2">
          {current !== null ? (
            <Button
              variant="outline"
              className="flex-1 rounded-lg"
              onClick={() => void save("")}
              disabled={isLoading}
            >
              改回原本的名字
            </Button>
          ) : (
            <Button
              variant="outline"
              className="flex-1 rounded-lg"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              取消
            </Button>
          )}
          <Button
            className="flex-1 rounded-lg"
            onClick={() => void save(name)}
            disabled={isLoading || !check.ok}
          >
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : "儲存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
