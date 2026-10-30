"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { Platform } from "@/components/pages/platform";
import { useLoginRedirect } from "@/components/pages/use-login-redirect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorText } from "@/lib/api-error";
import { SUPPORTED_CURRENCIES } from "@/lib/zod";
import { useCreateGroupMutation } from "@/store/api";

/** 建立群組: a group with no Telegram chat, and the creator as its first member. */
export function GroupCreatePage({ platform }: { platform: Platform }) {
  const router = useRouter();
  platform.useBack(platform.basePath);
  const [title, setTitle] = useState("");
  const [currency, setCurrency] = useState("TWD");
  const [createGroup, { isLoading, error }] = useCreateGroupMutation();
  useLoginRedirect(error, platform.loginPath);

  const trimmed = title.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || isLoading) return;
    try {
      const { id } = await createGroup({ title: trimmed, defaultCurrency: currency }).unwrap();
      router.replace(`${platform.basePath}/groups/${id}`);
    } catch {
      // Shown below from the mutation's error.
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5 px-4 py-4">
      <div>
        <platform.BackLink href={platform.basePath} />
        <h1 className="text-lg font-semibold">建立群組</h1>
      </div>

      <label className="block space-y-2">
        <span className="sect">群組名稱</span>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={50}
          placeholder="例如：東京旅行"
          autoFocus
        />
      </label>

      <div className="space-y-2">
        <span className="sect">預設幣別</span>
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger aria-label="預設幣別">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_CURRENCIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <p className="text-sm text-destructive">{apiErrorText(error, "建立失敗，請再試一次")}</p>
      )}

      <Button type="submit" className="w-full" disabled={!trimmed || isLoading}>
        {isLoading ? "建立中…" : "建立群組"}
      </Button>
    </form>
  );
}
