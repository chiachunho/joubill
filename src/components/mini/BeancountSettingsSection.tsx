"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import useSWR from "swr";

import { Avatar } from "@/components/mini/Avatar";
import { BeancountSettingsSkeleton } from "@/components/mini/skeletons";
import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { beancountAccountName, DEFAULT_BEANCOUNT_ACCOUNTS } from "@/lib/beancount";
import { labelMember } from "@/lib/label";
import {
  BEANCOUNT_ACCOUNT_HINT,
  BEANCOUNT_ACCOUNT_RE,
  BEANCOUNT_LEAF_HINT,
  BEANCOUNT_LEAF_RE,
  type BeancountConfigInput,
} from "@/lib/zod";

const BEANCOUNT_PROJECT_URL = "https://github.com/beancount/beancount";

/** How long the post-save "已儲存" flag stays up before reverting to the plain button. */
const SAVED_FLAG_MS = 2000;

/**
 * Open an external link from either surface. Mirrors the help-site pattern
 * (`src/app/mini/settings/page.tsx`): inside the Mini App's Telegram webview a
 * plain `<a>`/`window.open` would navigate the webview itself away rather than
 * opening a browser, so try `WebApp.openLink` first; outside Telegram (the Web
 * App, or a browser preview) the SDK call itself falls back to `window.open`.
 */
function openExternal(url: string) {
  import("@twa-dev/sdk")
    .then(({ default: WebApp }) => WebApp.openLink(url))
    .catch(() => window.open(url, "_blank", "noopener"));
}

type Member = {
  id: number;
  firstName: string | null;
  lastName?: string | null;
  username: string | null;
};

type Config = BeancountConfigInput;

type ConfigResponse = { config: Config | null };

type Props = {
  groupId: string;
  /** Group members, from the host page's own members SWR call. */
  members: Member[];
  rawFetch: (url: string, init?: RequestInit) => Promise<Response>;
};

function Intro() {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      啟用後，這個群組的支出／還款編輯頁會出現「複製 beancount」按鈕（只有你看得到），可自訂輸出的
      account 名稱。{" "}
      <button
        type="button"
        onClick={() => openExternal(BEANCOUNT_PROJECT_URL)}
        className="inline-flex items-center gap-0.5 font-medium text-primary"
      >
        什麼是 beancount？
        <ExternalLink className="size-3" />
      </button>
    </p>
  );
}

/**
 * Per-(user, group) beancount account customisation. Enabling it (saving a
 * config) is what makes the "copy record as beancount" button appear on this
 * group's expense/settlement edit pages — for the current user only. Renders
 * as the sole content of the Beancount 帳戶名稱設定 settings sub-page (Mini
 * App and Web App each have a copy) — no internal heading, the page owns its
 * own `<h1>`. Apple Wi-Fi-style: a description + toggle card is always shown;
 * the account fields and per-member accounts only appear once the toggle is
 * on (`config !== null`). Auth is injected via `rawFetch`.
 */
export function BeancountSettingsSection({ groupId, members, rawFetch }: Props) {
  const { data, error, mutate } = useSWR<ConfigResponse>(`/api/groups/${groupId}/beancount`);
  const config = data?.config ?? null;

  if (error) {
    return (
      <section className="px-4">
        <div className="rounded-2xl bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
          無法載入設定
        </div>
      </section>
    );
  }

  if (!data) return <BeancountSettingsSkeleton />;

  // `key` remounts Off/On only when the enabled state actually flips, not on
  // every background revalidation — that's what lets `On` seed its editable
  // state once and keep it across a `mutate()` triggered by its own save.
  return config === null ? (
    <Off key="off" groupId={groupId} rawFetch={rawFetch} onChange={mutate} />
  ) : (
    <On key="on" groupId={groupId} members={members} rawFetch={rawFetch} initial={config} onChange={mutate} />
  );
}

function Off({
  groupId,
  rawFetch,
  onChange,
}: {
  groupId: string;
  rawFetch: Props["rawFetch"];
  onChange: () => void;
}) {
  const [enabling, setEnabling] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function enable() {
    if (enabling) return;
    setEnabling(true);
    setErr(null);
    try {
      const res = await rawFetch(`/api/groups/${groupId}/beancount`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expensesAccount: DEFAULT_BEANCOUNT_ACCOUNTS.expenses,
          cashAccount: DEFAULT_BEANCOUNT_ACCOUNTS.cash,
          receivablePrefix: DEFAULT_BEANCOUNT_ACCOUNTS.receivablePrefix,
          personAccounts: {},
        }),
      });
      if (!res.ok) {
        setErr("啟用失敗，請再試一次");
        return;
      }
      await onChange();
    } catch {
      setErr("啟用失敗，請再試一次");
    } finally {
      setEnabling(false);
    }
  }

  return (
    <section className="px-4">
      <div className="overflow-hidden rounded-2xl bg-secondary/50">
        <div className="px-4 py-4">
          <Intro />
        </div>
        <div className="flex items-center justify-between border-t border-border/40 px-4 py-3">
          <span className="text-sm font-medium">啟用</span>
          <Switch checked={enabling} disabled={enabling} onCheckedChange={enable} />
        </div>
      </div>
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
    </section>
  );
}

function On({
  groupId,
  members,
  rawFetch,
  initial,
  onChange,
}: {
  groupId: string;
  members: Member[];
  rawFetch: Props["rawFetch"];
  initial: Config;
  onChange: () => void;
}) {
  const [expensesAccount, setExpensesAccount] = useState(initial.expensesAccount);
  const [cashAccount, setCashAccount] = useState(initial.cashAccount);
  const [receivablePrefix, setReceivablePrefix] = useState(initial.receivablePrefix);
  const [personAccounts, setPersonAccounts] = useState<Record<string, string>>(
    initial.personAccounts,
  );
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  // Any mutation in flight disables every field — a save and a disable can't
  // overlap, and the fields shouldn't be editable mid-request either.
  const busy = saving || disabling;

  const accountValid = (v: string) => BEANCOUNT_ACCOUNT_RE.test(v.trim());
  const leafValid = (v: string) => v.trim() === "" || BEANCOUNT_LEAF_RE.test(v.trim());
  const canSave =
    !busy &&
    accountValid(expensesAccount) &&
    accountValid(cashAccount) &&
    accountValid(receivablePrefix) &&
    members.every((m) => leafValid(personAccounts[String(m.id)] ?? ""));

  /** Clear the transient "已儲存" flag as soon as the user changes anything again. */
  function markDirty() {
    if (savedTimer.current) {
      clearTimeout(savedTimer.current);
      savedTimer.current = null;
    }
    setJustSaved(false);
  }

  function setPerson(id: number, value: string) {
    markDirty();
    setPersonAccounts((prev) => ({ ...prev, [String(id)]: value }));
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setErr(null);
    // Drop blank person entries so they fall back to the auto-derived name.
    const cleaned: Record<string, string> = {};
    for (const m of members) {
      const v = (personAccounts[String(m.id)] ?? "").trim();
      if (v) cleaned[String(m.id)] = v;
    }
    try {
      const res = await rawFetch(`/api/groups/${groupId}/beancount`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expensesAccount: expensesAccount.trim(),
          cashAccount: cashAccount.trim(),
          receivablePrefix: receivablePrefix.trim(),
          personAccounts: cleaned,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(d.error ?? "儲存失敗，請再試一次");
        return;
      }
      await onChange();
      setJustSaved(true);
      savedTimer.current = setTimeout(() => setJustSaved(false), SAVED_FLAG_MS);
    } catch {
      setErr("儲存失敗，請再試一次");
    } finally {
      setSaving(false);
    }
  }

  async function disable() {
    if (disabling) return;
    setDisabling(true);
    setErr(null);
    try {
      const res = await rawFetch(`/api/groups/${groupId}/beancount`, { method: "DELETE" });
      if (!res.ok) {
        setErr("停用失敗，請再試一次");
        return;
      }
      setConfirmOpen(false);
      await onChange();
    } catch {
      setErr("停用失敗，請再試一次");
    } finally {
      setDisabling(false);
    }
  }

  const field = (
    label: string,
    value: string,
    onValue: (v: string) => void,
    placeholder: string,
  ) => (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input
        value={value}
        onChange={(e) => {
          markDirty();
          onValue(e.target.value);
        }}
        placeholder={placeholder}
        disabled={busy}
        className={`h-8 rounded-lg border-0 bg-background/60 text-sm ${
          accountValid(value) ? "" : "ring-1 ring-destructive"
        }`}
      />
      {!accountValid(value) && <p className="text-xs text-destructive">{BEANCOUNT_ACCOUNT_HINT}</p>}
    </div>
  );

  return (
    <>
      <section className="px-4">
        <div className="overflow-hidden rounded-2xl bg-secondary/50">
          <div className="px-4 py-4">
            <Intro />
          </div>
          <div className="flex items-center justify-between border-t border-border/40 px-4 py-3">
            <span className="text-sm font-medium">啟用</span>
            <Switch checked disabled={busy} onCheckedChange={() => setConfirmOpen(true)} />
          </div>
        </div>
      </section>

      <section className="px-4">
        <p className="sect mb-2.5">帳戶設定</p>
        <div className="overflow-hidden rounded-2xl bg-secondary/50">
          <div className="space-y-3 px-4 py-3">
            {field(
              "Expenses 帳戶",
              expensesAccount,
              setExpensesAccount,
              DEFAULT_BEANCOUNT_ACCOUNTS.expenses,
            )}
            {field("Cash 帳戶", cashAccount, setCashAccount, DEFAULT_BEANCOUNT_ACCOUNTS.cash)}
            {field(
              "Receivable 前綴",
              receivablePrefix,
              setReceivablePrefix,
              DEFAULT_BEANCOUNT_ACCOUNTS.receivablePrefix,
            )}
          </div>
        </div>
      </section>

      <section className="px-4">
        <p className="sect mb-2.5">成員帳戶</p>
        <p className="mb-2 text-xs text-muted-foreground">
          接在 {receivablePrefix.trim() || DEFAULT_BEANCOUNT_ACCOUNTS.receivablePrefix} 之後；留空則自動取名
        </p>
        <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
          {members.map((m) => {
            const key = String(m.id);
            const value = personAccounts[key] ?? "";
            const auto = beancountAccountName({
              userId: m.id,
              firstName: m.firstName,
              lastName: m.lastName ?? null,
              username: m.username,
            });
            const name = labelMember(m);
            return (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={name} userId={m.id} size="sm" />
                <span className="w-20 shrink-0 truncate text-sm" title={name}>
                  {name}
                </span>
                <div className="min-w-0 flex-1">
                  <Input
                    value={value}
                    onChange={(e) => setPerson(m.id, e.target.value)}
                    placeholder={auto}
                    disabled={busy}
                    className={`h-8 rounded-lg border-0 bg-background/60 text-sm ${
                      leafValid(value) ? "" : "ring-1 ring-destructive"
                    }`}
                  />
                  {!leafValid(value) && (
                    <p className="mt-1 text-xs text-destructive">{BEANCOUNT_LEAF_HINT}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex items-center gap-3 px-4">
        <Button type="button" size="sm" className="rounded-lg" disabled={!canSave} onClick={save}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : "儲存"}
        </Button>
        {justSaved && (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
            <Check className="size-3.5" />
            已儲存
          </span>
        )}
      </section>

      {err && <p className="px-4 text-sm text-destructive">{err}</p>}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="停用 beancount 複製？"
        description={
          <span>
            停用後，「複製 beancount」按鈕會立刻消失（只影響你自己看到的功能）。目前自訂的帳戶設定不會保留——之後重新啟用會回到預設值。
            {/* The outer {err} paragraph below sits behind this dialog's overlay
                while it's open, so a failed disable needs its own copy here too. */}
            {err && <span className="mt-2 block text-destructive">{err}</span>}
          </span>
        }
        confirmLabel="確定停用"
        variant="destructive"
        loading={disabling}
        onConfirm={disable}
      />
    </>
  );
}
