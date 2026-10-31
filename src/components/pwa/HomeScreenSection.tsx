"use client";

import { useState } from "react";
import { Smartphone } from "lucide-react";

import { AddToHomeScreenDialog } from "@/components/pwa/AddToHomeScreenDialog";
import { Button } from "@/components/ui/button";
import { promptInstall, useHasInstallPrompt } from "@/lib/install-prompt";
import { homeScreenOffer, type PwaEnv } from "@/lib/pwa";

/**
 * 個人設定 → 主畫面捷徑. Hidden when there is nothing to offer: already opened from the home
 * screen, or a browser that can't add one.
 */
export function HomeScreenSection({ env }: { env: PwaEnv }) {
  const hasPrompt = useHasInstallPrompt();
  const [stepsOpen, setStepsOpen] = useState(false);
  const offer = homeScreenOffer(env, hasPrompt);
  if (offer === "installed" || offer === "none") return null;

  return (
    <section className="px-4">
      <p className="sect mb-2.5">主畫面捷徑</p>
      <div className="flex items-center gap-3 rounded-2xl bg-secondary/50 px-4 py-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Smartphone className="size-3.5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm">加到主畫面</p>
          <p className="text-xs text-muted-foreground">在桌面放一個揪帳捷徑，不用下載</p>
        </div>
        <Button
          size="sm"
          onClick={() => (offer === "prompt" ? void promptInstall() : setStepsOpen(true))}
        >
          {offer === "prompt" ? "加入" : "怎麼加"}
        </Button>
      </div>
      {env.ios && (
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          主畫面的揪帳跟 Safari 不共用登入，第一次打開要再登入一次。
        </p>
      )}
      <AddToHomeScreenDialog open={stepsOpen} onOpenChange={setStepsOpen} />
    </section>
  );
}
