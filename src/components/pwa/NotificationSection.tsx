"use client";

import { useState, type ReactNode } from "react";
import { Bell, BellOff, ChevronRight, Send } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { NEVER } from "@/lib/onboarding-prompts";
import { writePromptRecord } from "@/lib/prompt-storage";
import type { PwaEnv } from "@/lib/pwa";
import { usePushDevice } from "@/lib/use-push-device";
import { useSendTestPushMutation } from "@/store/api";

const ABOUT =
  "只通知跟你有關的紀錄：別人記了你要分的帳、你收到還款、你記的帳被別人改或刪。你自己做的改動不會通知。各群組可在群組設定裡關掉。";

const DENIED_HINT =
  "你之前選了「不允許」，網頁沒辦法再問一次。請到手機或瀏覽器的設定裡，找到揪帳打開通知，再回到這頁。";

/**
 * 個人設定 → 通知 (issue #67). The switch is about this device only: each phone or browser
 * that should be notified turns it on for itself.
 */
export function NotificationSection({ env }: { env: PwaEnv }) {
  const device = usePushDevice(env);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testState, setTestState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [sendTest] = useSendTestPushMutation();

  if (device.loading || !device.configured) return null;

  const on = device.endpoint !== null;
  const denied = device.permission === "denied";

  async function toggle(next: boolean) {
    setError(null);
    setBusy(true);
    try {
      if (next) {
        const result = await device.enable();
        if (result === "denied") writePromptRecord("push", NEVER);
        if (result === "failed") setError("沒有開成功，請再試一次。");
      } else {
        // Turning it off is an answer: the group page stops offering it on this device.
        writePromptRecord("push", NEVER);
        if (!(await device.disable())) setError("沒有關成功，請再試一次。");
      }
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (!device.endpoint) return;
    setTestState("sending");
    try {
      await sendTest({ endpoint: device.endpoint }).unwrap();
      setTestState("sent");
    } catch {
      setTestState("failed");
    }
  }

  let status: ReactNode;
  let note: string | null = ABOUT;
  let disabled = busy;
  if (device.support === "unsupported") {
    return (
      <section className="px-4">
        <p className="sect mb-2.5">通知</p>
        <div className="rounded-2xl bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
          這個瀏覽器不支援推播通知。可以改用 Chrome、Edge、Firefox，或在 iPhone 上把揪帳加到主畫面。
        </div>
      </section>
    );
  } else if (device.support === "needs-home-screen") {
    status = "需要先加到主畫面";
    note =
      "iPhone 只有從主畫面打開揪帳時才能收通知（iOS 16.4 以上）。先完成下面的「加到主畫面」，再從主畫面打開回到這裡。";
    disabled = true;
  } else if (denied) {
    status = <span className="text-destructive">通知已被封鎖</span>;
    note = DENIED_HINT;
    // Turning it back on needs the browser's settings, but a subscription the browser kept
    // must still be removable from here.
    disabled = busy || !on;
  } else {
    status = busy ? (on ? "關閉中…" : "開啟中…") : on ? "已開啟" : "尚未開啟";
  }

  return (
    <section className="px-4">
      <p className="sect mb-2.5">通知</p>
      <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
        <label className="flex items-center gap-3 px-4 py-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
            {denied ? (
              <BellOff className="size-3.5 text-primary" />
            ) : (
              <Bell className="size-3.5 text-primary" />
            )}
          </div>
          <div className={disabled && !busy ? "min-w-0 flex-1 opacity-60" : "min-w-0 flex-1"}>
            <p className="text-sm">這台裝置的推播</p>
            <p className="text-xs text-muted-foreground">{status}</p>
          </div>
          <Switch
            aria-label="這台裝置的推播"
            checked={on}
            disabled={disabled}
            onCheckedChange={(next) => void toggle(next)}
          />
        </label>
        {on && device.support === "supported" && (
          <button
            type="button"
            onClick={() => void test()}
            disabled={testState === "sending"}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30 active:bg-accent/50 disabled:opacity-50"
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Send className="size-3.5 text-primary" />
            </div>
            <span className="flex-1 text-sm">傳送測試通知</span>
            {testState === "sent" && <span className="text-xs text-muted-foreground">已送出</span>}
            {testState === "failed" && <span className="text-xs text-destructive">送不出去</span>}
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
          </button>
        )}
      </div>
      {error && <p className="mt-2 px-1 text-xs text-destructive">{error}</p>}
      {note && <p className="mt-2 px-1 text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}
