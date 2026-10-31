"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiErrorText } from "@/lib/api-error";
import type { ProfileResponse } from "@/lib/api-types";
import { isLoginProvider, PROVIDER_LABEL } from "@/lib/identities";
import { useUpdateProfileMutation } from "@/store/api";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: ProfileResponse;
  /** Alt text for the pictures. */
  name: string;
};

/**
 * 頭像: which linked login's picture to show. Only logins that have one are offered (the server
 * refuses anything else); 自動 is Telegram's photo first, then the others in the listed order.
 * A tap saves and closes, like any picker.
 */
export function AvatarSourceDialog({ open, onOpenChange, profile, name }: Props) {
  const [updateProfile] = useUpdateProfileMutation();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const auto = profile.avatarOptions[0];
  const rows: { key: string | null; label: string; url: string | null; hint: string }[] = [
    {
      key: null,
      label: "自動",
      url: auto?.url ?? null,
      hint: auto && isLoginProvider(auto.source) ? `目前用 ${PROVIDER_LABEL[auto.source]}` : "",
    },
    ...profile.avatarOptions.map((o) => ({
      key: o.source,
      label: isLoginProvider(o.source) ? PROVIDER_LABEL[o.source] : o.source,
      url: o.url,
      hint: "",
    })),
  ];

  async function choose(key: string | null) {
    if (saving !== null) return;
    if (key === profile.avatarSource) return onOpenChange(false);
    setSaving(key ?? "auto");
    setError(null);
    try {
      await updateProfile({ avatarSource: key }).unwrap();
      onOpenChange(false);
    } catch (e) {
      setError(apiErrorText(e, "儲存失敗，請再試一次"));
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={saving !== null ? undefined : onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>頭像</DialogTitle>
          <DialogDescription>從已連結的登入方式挑一張。</DialogDescription>
        </DialogHeader>
        <div
          role="radiogroup"
          aria-label="頭像來源"
          className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50"
        >
          {rows.map((row) => {
            const selected = row.key === profile.avatarSource;
            const busy = saving === (row.key ?? "auto");
            return (
              <button
                key={row.key ?? "auto"}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={saving !== null}
                onClick={() => void choose(row.key)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30 active:bg-accent/50 disabled:opacity-60"
              >
                {row.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={row.url}
                    alt={name}
                    referrerPolicy="no-referrer"
                    className="size-9 shrink-0 rounded-full object-cover ring-1 ring-black/10 dark:ring-white/10"
                  />
                ) : (
                  <div className="size-9 shrink-0 rounded-full bg-primary/10" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{row.label}</span>
                  {row.hint && (
                    <span className="block text-xs text-muted-foreground">{row.hint}</span>
                  )}
                </span>
                {busy ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : (
                  selected && <Check className="size-4 text-primary" />
                )}
              </button>
            );
          })}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
