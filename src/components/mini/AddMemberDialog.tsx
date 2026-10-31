"use client";

import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Link2, UserPlus } from "lucide-react";

import { AddPlaceholderDialog } from "@/components/mini/AddPlaceholderDialog";
import { InviteActions } from "@/components/mini/InviteActions";
import type { InviteHint } from "@/components/pages/platform";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Step = "choose" | "invite" | "name";

/**
 * 新增成員: the one way into adding people, opened from 群組設定's member list and from the
 * one-person group card. It asks first how to add someone: a member without an account goes
 * to the existing name dialog (`AddPlaceholderDialog`, opened after this one closes rather
 * than nested in it), an invite stays in this dialog and shows `InviteActions`.
 */
export function AddMemberDialog({
  groupId,
  open,
  onOpenChange,
  inviteHint,
}: {
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What to tell the inviter about handing the invite over (`Platform.inviteHint`). */
  inviteHint: InviteHint;
}) {
  const [step, setStep] = useState<Step>("choose");
  const [wasOpen, setWasOpen] = useState(open);

  // Every opening starts at the choice, whatever step the last one ended on. Set while
  // rendering (not in an effect) so a reopened dialog never paints the old step first.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setStep("choose");
  }

  const option = (onClick: () => void, icon: ReactNode, title: string, description: string) => (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg bg-secondary/50 p-3.5 text-left transition-colors hover:bg-secondary active:bg-secondary"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );

  return (
    <>
      <Dialog open={open && step !== "name"} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm rounded-2xl">
          {step === "invite" ? (
            <>
              <DialogHeader className="text-left">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setStep("choose")}
                    aria-label="返回"
                    className="-ml-1.5 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                  <DialogTitle>用邀請碼邀請</DialogTitle>
                </div>
                <DialogDescription>
                  拿到連結或邀請碼的人都能加入，請只傳給你要邀請的人。
                </DialogDescription>
              </DialogHeader>
              <InviteActions groupId={groupId} hint={inviteHint} />
            </>
          ) : (
            <>
              <DialogHeader className="text-left">
                <DialogTitle>新增成員</DialogTitle>
                <DialogDescription>要怎麼把人加進這個群組？</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {option(
                  () => {
                    onOpenChange(false);
                    setStep("name");
                  },
                  <UserPlus className="size-[18px]" />,
                  "新增沒有帳號的成員",
                  "只要名字，就能幫他記帳、分帳",
                )}
                {option(
                  () => setStep("invite"),
                  <Link2 className="size-[18px]" />,
                  "用邀請碼邀請",
                  "傳連結或邀請碼，對方用自己的帳號加入",
                )}
              </div>
              <Button
                variant="outline"
                className="w-full rounded-lg"
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AddPlaceholderDialog
        groupId={groupId}
        open={step === "name"}
        onOpenChange={(next) => {
          if (!next) setStep("choose");
        }}
      />
    </>
  );
}
