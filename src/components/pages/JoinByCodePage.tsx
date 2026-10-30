"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { Platform } from "@/components/pages/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseInviteCode } from "@/lib/invite";

/** 輸入邀請碼: takes a code or a pasted link and continues to the shared join page. */
export function JoinByCodePage({ platform }: { platform: Platform }) {
  const router = useRouter();
  platform.useBack(platform.basePath);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const code = parseInviteCode(value);
    if (!code) {
      setInvalid(true);
      return;
    }
    router.push(`${platform.basePath}/join/${code}`);
  }

  return (
    <form onSubmit={submit} className="space-y-5 px-4 py-4">
      <div>
        <platform.BackLink href={platform.basePath} />
        <h1 className="text-lg font-semibold">輸入邀請碼</h1>
      </div>

      <label className="block space-y-2">
        <span className="sect">邀請碼或連結</span>
        <Input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setInvalid(false);
          }}
          placeholder="K7M2Q-X9PAB"
          autoCapitalize="characters"
          autoComplete="off"
          autoFocus
        />
      </label>
      {invalid && <p className="text-sm text-destructive">邀請碼格式不正確，請再確認一次</p>}

      <Button type="submit" className="w-full" disabled={!value.trim()}>
        繼續
      </Button>
    </form>
  );
}
