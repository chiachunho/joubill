"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/*
 * The step-by-step sheet for adding the Web App to an iPhone's home screen. iOS gives a page
 * no way to start it, so the only thing the app can do is show where to tap.
 *
 * The small pictures copy iOS 26 Safari, not the app's own look: what someone has to find is
 * iOS's button, so it is drawn in iOS's colours (system blue, system green, system font), not
 * through the design tokens. The place to tap is ringed in the app's primary colour.
 *
 * Step 1 covers both Safari layouts. In the default 精簡 tab bar, Share is behind ⋯; with
 * 底部 or 頂部 chosen in Settings (or before iOS 26) the toolbar shows Share directly. A page
 * can't read that setting, so the text names both.
 */

const IOS_FONT = {
  fontFamily: '-apple-system, "SF Pro Text", "PingFang TC", system-ui, sans-serif',
};

function ShareGlyph({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M8.6 9.2H7.2a2.2 2.2 0 0 0-2.2 2.2v8.4A2.2 2.2 0 0 0 7.2 22h9.6a2.2 2.2 0 0 0 2.2-2.2v-8.4a2.2 2.2 0 0 0-2.2-2.2h-1.4" />
      <path d="M12 14.6V2.4" />
      <path d="M8.4 5.9 12 2.3l3.6 3.6" />
    </svg>
  );
}

function MoreGlyph({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <circle cx="5.5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="18.5" cy="12" r="1.9" />
    </svg>
  );
}

function PlusAppGlyph({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4.2" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2 text-sm">{children}</div>
    </li>
  );
}

/** iOS 26 Safari's floating bottom bar, with ⋯ ringed. */
function SafariBar() {
  return (
    <div
      aria-hidden
      style={IOS_FONT}
      className="flex items-center gap-1.5 rounded-full border border-black/5 bg-[#F2F2F7] p-1.5 text-black shadow-sm"
    >
      <span className="flex size-8 items-center justify-center rounded-full bg-white">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          className="size-4"
        >
          <path d="M15 4 7 12l8 8" />
        </svg>
      </span>
      <span className="flex h-8 flex-1 items-center justify-center rounded-full bg-white text-xs">
        揪帳
      </span>
      <span className="flex size-8 items-center justify-center rounded-full bg-white ring-2 ring-primary ring-offset-1">
        <MoreGlyph />
      </span>
    </div>
  );
}

/** The end of iOS's share sheet, with 加入主畫面 ringed. */
function ShareSheetRows() {
  return (
    <div
      aria-hidden
      style={IOS_FONT}
      className="divide-y divide-[#D1D1D6] overflow-hidden rounded-lg border border-black/5 bg-white text-xs text-black"
    >
      <div className="flex items-center justify-between px-3 py-2">
        <span>加入書籤</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinejoin="round"
          className="size-4"
        >
          <path d="M12 6.5C10 4.8 6.8 4.2 3.5 4.6v14c3.3-.4 6.5.2 8.5 1.9 2-1.7 5.2-2.3 8.5-1.9v-14c-3.3-.4-6.5.2-8.5 1.9Z" />
          <path d="M12 6.5v14" />
        </svg>
      </div>
      <div className="flex items-center justify-between rounded-lg px-3 py-2 ring-2 ring-inset ring-primary">
        <span>加入主畫面</span>
        <PlusAppGlyph />
      </div>
    </div>
  );
}

/** iOS's 加入主畫面 screen, with 加入 ringed and 以網頁 App 打開 left on. */
function AddScreen() {
  return (
    <div
      aria-hidden
      style={IOS_FONT}
      className="space-y-1.5 rounded-lg border border-black/5 bg-[#F2F2F7] p-2 text-xs text-black"
    >
      <div className="flex items-center justify-between px-1 text-[#007AFF]">
        <span>取消</span>
        <span className="font-semibold text-black">加入主畫面</span>
        <span className="rounded px-1 font-semibold ring-2 ring-primary">加入</span>
      </div>
      <div className="flex items-center justify-between rounded-md bg-white px-2.5 py-1.5">
        <span>以網頁 App 打開</span>
        <span className="relative h-[18px] w-[30px] rounded-full bg-[#34C759]">
          <span className="absolute right-0.5 top-0.5 size-[14px] rounded-full bg-white shadow" />
        </span>
      </div>
    </div>
  );
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 下次再說, offered when the sheet was opened from the group page's card. */
  onLater?: () => void;
};

export function AddToHomeScreenDialog({ open, onOpenChange, onLater }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>把揪帳加到 iPhone 主畫面</DialogTitle>
          <DialogDescription>在桌面放一個揪帳捷徑，一點就打開，不用下載。</DialogDescription>
        </DialogHeader>

        <ol className="space-y-4">
          <Step n={1}>
            <p>
              點網址列旁的
              <MoreGlyph className="mx-1 inline size-4 align-[-3px] text-[#007AFF]" />
              ，再點「分享」
            </p>
            <p className="text-xs text-muted-foreground">
              畫面下方直接看得到分享鈕
              <ShareGlyph className="mx-1 inline size-3.5 align-[-2px] text-[#007AFF]" />
              的話，點它就好。
            </p>
            <SafariBar />
          </Step>
          <Step n={2}>
            <p>往下滑，點「加入主畫面」</p>
            <ShareSheetRows />
          </Step>
          <Step n={3}>
            <p>右上角點「加入」</p>
            <AddScreen />
          </Step>
          <Step n={4}>
            <p>
              回到桌面，點揪帳圖示打開，<strong>再登入一次</strong>
            </p>
            <p className="text-xs text-muted-foreground">主畫面的揪帳跟 Safari 不共用登入。</p>
          </Step>
        </ol>

        <DialogFooter className="flex-row gap-2">
          {onLater && (
            <Button variant="outline" className="flex-1 rounded-lg" onClick={onLater}>
              下次再說
            </Button>
          )}
          <Button className="flex-1 rounded-lg" onClick={() => onOpenChange(false)}>
            知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
