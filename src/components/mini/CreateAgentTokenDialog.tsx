"use client";

import { useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";

import {
  AgentAccessPicker,
  AgentScopePicker,
  scopeIsValid,
  type Scope,
} from "@/components/mini/AgentFormFields";
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
import { DEFAULT_EXPIRY_DAYS, EXPIRY_CHOICES } from "@/lib/agent-ui";
import { apiErrorText } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { useCreateAgentConnectionMutation } from "@/store/api";

type Groups = { id: number; title: string; defaultCurrency: string }[];

/**
 * 建立個人權杖. The form starts on the narrowest grant (唯讀, no group ticked, not "all
 * groups"), so doing nothing but typing a name and picking a group is the safe outcome.
 *
 * The token is shown once: it lives in this component's state only, the dialog can't be
 * dismissed while it is on screen except through 完成, and closing drops it. Where the
 * clipboard refuses, a read-only field that selects itself on focus takes over, the same as
 * the invite code.
 */
export function CreateAgentTokenDialog({
  open,
  onOpenChange,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: Groups;
}) {
  const [create, { isLoading, reset }] = useCreateAgentConnectionMutation();
  const [name, setName] = useState("");
  const [access, setAccess] = useState<"read" | "write">("read");
  const [scope, setScope] = useState<Scope>({ allGroups: false, groupIds: [] });
  const [days, setDays] = useState<number | null>(DEFAULT_EXPIRY_DAYS);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);

  const canSubmit = name.trim().length > 0 && scopeIsValid(scope) && !isLoading;

  function close() {
    setName("");
    setAccess("read");
    setScope({ allGroups: false, groupIds: [] });
    setDays(DEFAULT_EXPIRY_DAYS);
    setError(null);
    setToken(null);
    setCopied(false);
    setManual(false);
    reset();
    onOpenChange(false);
  }

  async function submit() {
    setError(null);
    try {
      const res = await create({
        name: name.trim(),
        access,
        allGroups: scope.allGroups,
        groupIds: scope.allGroups ? [] : scope.groupIds,
        ...(days ? { expiresInDays: days } : {}),
      }).unwrap();
      setToken(res.token);
    } catch (e) {
      setError(apiErrorText(e, "建立失敗"));
    }
  }

  async function copy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setManual(false);
    } catch {
      setManual(true);
    }
  }

  return (
    // While the token is up the only way out is 完成, so a stray tap can't lose it.
    <Dialog open={open} onOpenChange={token ? undefined : (o) => !o && close()}>
      <DialogContent
        className={cn(
          "max-h-[90dvh] max-w-sm overflow-y-auto rounded-2xl",
          token && "[&>button.absolute]:hidden",
        )}
      >
        {token ? (
          <>
            <DialogHeader>
              <DialogTitle>複製這組權杖</DialogTitle>
              <DialogDescription>離開這頁後就看不到了。弄丟的話，撤銷再建一組。</DialogDescription>
            </DialogHeader>
            <input
              readOnly
              value={token}
              aria-label="權杖"
              autoFocus={manual}
              onFocus={(e) => e.currentTarget.select()}
              className="num w-full rounded-lg border border-border bg-background px-3 py-2 text-xs"
            />
            {manual && (
              <p className="text-xs text-destructive">無法自動複製，請長按或選取上面的文字複製</p>
            )}
            <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
              <Button className="w-full rounded-lg" onClick={copy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "已複製" : manual ? "再試一次複製" : "複製權杖"}
              </Button>
              <Button variant="outline" className="w-full rounded-lg" onClick={close}>
                完成
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>建立個人權杖</DialogTitle>
              <DialogDescription>給 Claude Code、Cursor、n8n、捷徑等工具使用。</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="agent-token-name"
                  className="mb-1.5 block text-xs text-muted-foreground"
                >
                  名稱
                </label>
                <Input
                  id="agent-token-name"
                  value={name}
                  maxLength={60}
                  placeholder="例如：刷卡簡訊自動記帳"
                  onChange={(e) => setName(e.target.value)}
                  className="rounded-lg"
                />
              </div>
              <AgentAccessPicker value={access} onChange={setAccess} />
              <AgentScopePicker groups={groups} value={scope} onChange={setScope} />
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">到期</p>
                <div
                  role="radiogroup"
                  aria-label="到期"
                  className="grid grid-cols-3 gap-1 rounded-lg bg-secondary/60 p-1"
                >
                  {EXPIRY_CHOICES.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      role="radio"
                      aria-checked={days === c.days}
                      onClick={() => setDays(c.days)}
                      className={cn(
                        "rounded-md py-1.5 text-sm transition-colors",
                        days === c.days
                          ? "bg-background font-semibold shadow-sm"
                          : "text-muted-foreground",
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter className="flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1 rounded-lg"
                onClick={close}
                disabled={isLoading}
              >
                取消
              </Button>
              <Button className="flex-1 rounded-lg" onClick={submit} disabled={!canSubmit}>
                {isLoading && <Loader2 className="size-4 animate-spin" />}
                建立
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
