"use client";

import { useEffect, useState } from "react";
import { Bell, Smartphone } from "lucide-react";

import { IconTile } from "@/components/mini/IconTile";
import { AddToHomeScreenDialog } from "@/components/pwa/AddToHomeScreenDialog";
import { Button } from "@/components/ui/button";
import { promptInstall, useHasInstallPrompt } from "@/lib/install-prompt";
import {
  NEVER,
  nextPrompt,
  snooze,
  STEPS_SEEN_DAYS,
  type PromptKind,
  type PromptRecord,
} from "@/lib/onboarding-prompts";
import {
  readPromptRecord,
  readShownThisVisit,
  writePromptRecord,
  writeShownThisVisit,
} from "@/lib/prompt-storage";
import { homeScreenOffer, type PwaEnv } from "@/lib/pwa";
import { usePushDevice } from "@/lib/use-push-device";
import { usePwaEnv } from "@/lib/use-pwa-env";

/**
 * The group page's one card (issue #67): first 把揪帳加到主畫面？, on a later visit 朋友記了你要分的
 * 帳時通知你？. Which one, and whether any, is `nextPrompt`; this only supplies the browser's
 * state and stores the answer. Rendered by the Web App only (`Platform.GroupPrompt`), and only
 * for a group with someone else in it.
 */
export function OnboardingPromptCard() {
  const env = usePwaEnv();
  if (!env) return null;
  return <PromptCard env={env} />;
}

type Stored = { records: Record<PromptKind, PromptRecord>; shownThisVisit: PromptKind | null };

function readStored(): Stored {
  return {
    records: { "home-screen": readPromptRecord("home-screen"), push: readPromptRecord("push") },
    shownThisVisit: readShownThisVisit(),
  };
}

function PromptCard({ env }: { env: PwaEnv }) {
  const device = usePushDevice(env);
  const hasInstallPrompt = useHasInstallPrompt();
  // Read at mount, not in an effect: this only mounts once `usePwaEnv` has resolved on the
  // client, so the server never renders it and there is no hydration to disagree with.
  const [stored, setStored] = useState<Stored>(readStored);
  // The time the card appeared. Snooze windows are days long, so this is as good as "now".
  const [now] = useState(() => Date.now());
  const [stepsOpen, setStepsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const kind = !device.loading
    ? nextPrompt({
        env,
        homeScreen: homeScreenOffer(env, hasInstallPrompt),
        pushConfigured: device.configured,
        permission: device.permission,
        subscribed: device.endpoint !== null,
        records: stored.records,
        now,
        hasOtherMembers: true,
        shownThisVisit: stored.shownThisVisit,
      })
    : null;

  useEffect(() => {
    if (kind && stored.shownThisVisit !== kind) writeShownThisVisit(kind);
  }, [kind, stored.shownThisVisit]);

  function answer(which: PromptKind, record: PromptRecord) {
    writePromptRecord(which, record);
    setStored((s) => ({ records: { ...s.records, [which]: record }, shownThisVisit: which }));
  }

  function later(which: PromptKind, days?: number) {
    answer(which, snooze(stored.records[which] ?? null, Date.now(), days));
  }

  if (message) {
    return (
      <div className="mx-4 rounded-2xl bg-primary/10 px-4 py-3 text-sm text-primary">{message}</div>
    );
  }
  if (!kind) return null;

  async function addToHomeScreen() {
    if (!hasInstallPrompt) {
      setStepsOpen(true);
      return;
    }
    const outcome = await promptInstall();
    if (outcome === "accepted") answer("home-screen", NEVER);
    else later("home-screen");
  }

  async function turnOnPush() {
    setBusy(true);
    setFailed(false);
    try {
      const result = await device.enable();
      if (result === "on") {
        answer("push", NEVER);
        setMessage("通知開好了。");
        setTimeout(() => setMessage(null), 3000);
      } else if (result === "denied") answer("push", NEVER);
      else if (result === "dismissed") later("push");
      // Keep the card, so the same button is the retry.
      else setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const isHome = kind === "home-screen";
  const Icon = isHome ? Smartphone : Bell;

  return (
    <div className="mx-4 space-y-3 rounded-2xl bg-primary/10 px-4 py-3">
      <div className="flex items-start gap-3">
        <IconTile icon={Icon} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold">
            {isHome ? "把揪帳加到主畫面？" : "朋友記了你要分的帳時通知你？"}
          </p>
          <p className="text-xs text-muted-foreground">
            {isHome
              ? "在桌面放一個捷徑，一點就打開，不用下載。加了之後也能收到記帳通知。"
              : "只通知跟你有關的紀錄，你自己記的不會通知。之後可以在個人設定關掉。"}
          </p>
        </div>
      </div>
      {failed && !isHome && (
        <p role="alert" className="text-xs text-destructive">
          沒有開成功，請再試一次。
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => answer(kind, NEVER)}
        >
          不要再問
        </Button>
        <Button variant="outline" size="sm" onClick={() => later(kind)} disabled={busy}>
          下次再說
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => void (isHome ? addToHomeScreen() : turnOnPush())}
        >
          {isHome ? "加到主畫面" : busy ? "開啟中…" : failed ? "再試一次" : "開啟通知"}
        </Button>
      </div>
      <AddToHomeScreenDialog
        open={stepsOpen}
        onOpenChange={(open) => {
          setStepsOpen(open);
          // 知道了 isn't a refusal: ask again in a few days if it still isn't on the home screen.
          if (!open) later("home-screen", STEPS_SEEN_DAYS);
        }}
        onLater={() => {
          setStepsOpen(false);
          later("home-screen");
        }}
      />
    </div>
  );
}
