"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { beancountAccountName, DEFAULT_BEANCOUNT_ACCOUNTS } from "@/lib/beancount";
import { BEANCOUNT_ACCOUNT_RE, BEANCOUNT_LEAF_RE } from "@/lib/zod";

type Member = {
  id: number;
  firstName: string | null;
  lastName?: string | null;
  username: string | null;
};

type Config = {
  expensesAccount: string;
  cashAccount: string;
  receivablePrefix: string;
  personAccounts: Record<string, string>;
};

type ConfigResponse = { config: Config | null };

type Props = {
  groupId: string;
  /** Group members, from the settings page's members SWR (avoids a duplicate fetch). */
  members: Member[];
  rawFetch: (url: string, init?: RequestInit) => Promise<Response>;
};

/**
 * Per-(user, group) beancount account customisation. Enabling it (saving a
 * config) is what makes the "copy record as beancount" button appear on this
 * group's expense/settlement edit pages — for the current user only. Shared by
 * the Mini App and Web App settings pages; auth is injected via `rawFetch`.
 */
export function BeancountSettingsSection({ groupId, members, rawFetch }: Props) {
  const { data, error, mutate } = useSWR<ConfigResponse>(`/api/groups/${groupId}/beancount`);
  const config = data?.config ?? null;

  return (
    <section className="px-4">
      <p className="sect mb-2.5">Beancount 複製</p>
      <div className="overflow-hidden rounded-2xl bg-secondary/50">
        {error ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">無法載入設定</p>
        ) : !data ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">載入中…</p>
        ) : config === null ? (
          <EnablePrompt groupId={groupId} rawFetch={rawFetch} onChange={mutate} />
        ) : (
          <Editor
            key="on"
            groupId={groupId}
            members={members}
            rawFetch={rawFetch}
            initial={config}
            onChange={mutate}
          />
        )}
      </div>
    </section>
  );
}

function EnablePrompt({
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
    <div className="space-y-3 px-4 py-3">
      <p className="text-sm text-muted-foreground">
        啟用後，這個群組的支出／還款編輯頁會出現「複製 beancount」按鈕（只有你看得到），可自訂輸出的
        account 名稱。
      </p>
      <Button type="button" size="sm" className="rounded-lg" disabled={enabling} onClick={enable}>
        {enabling ? <Loader2 className="size-3.5 animate-spin" /> : "啟用"}
      </Button>
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}

function Editor({
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
  const [disabling, setDisabling] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const accountValid = (v: string) => BEANCOUNT_ACCOUNT_RE.test(v.trim());
  const leafValid = (v: string) => v.trim() === "" || BEANCOUNT_LEAF_RE.test(v.trim());
  const canSave =
    accountValid(expensesAccount) &&
    accountValid(cashAccount) &&
    accountValid(receivablePrefix) &&
    members.every((m) => leafValid(personAccounts[String(m.id)] ?? ""));

  function setPerson(id: number, value: string) {
    setPersonAccounts((prev) => ({ ...prev, [String(id)]: value }));
  }

  async function save() {
    if (saving || !canSave) return;
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
        onChange={(e) => onValue(e.target.value)}
        placeholder={placeholder}
        className={`h-8 rounded-lg border-0 bg-background/60 text-sm ${
          accountValid(value) ? "" : "ring-1 ring-destructive"
        }`}
      />
    </div>
  );

  return (
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

      <div className="space-y-1.5 pt-1">
        <p className="text-xs text-muted-foreground">
          成員 account 名稱（接在{" "}
          {receivablePrefix.trim() || DEFAULT_BEANCOUNT_ACCOUNTS.receivablePrefix}{" "}
          之後；留空則自動取名）
        </p>
        {members.map((m) => {
          const key = String(m.id);
          const value = personAccounts[key] ?? "";
          const auto = beancountAccountName({
            userId: m.id,
            firstName: m.firstName,
            lastName: m.lastName ?? null,
            username: m.username,
          });
          const name =
            [m.firstName, m.lastName].filter(Boolean).join(" ") || m.username || `#${m.id}`;
          return (
            <div key={m.id} className="flex items-center gap-2">
              <span className="w-20 shrink-0 truncate text-sm">{name}</span>
              <Input
                value={value}
                onChange={(e) => setPerson(m.id, e.target.value)}
                placeholder={auto}
                className={`h-8 flex-1 rounded-lg border-0 bg-background/60 text-sm ${
                  leafValid(value) ? "" : "ring-1 ring-destructive"
                }`}
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          className="rounded-lg"
          disabled={!canSave || saving}
          onClick={save}
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : "儲存"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-lg"
          disabled={disabling}
          onClick={disable}
        >
          {disabling ? <Loader2 className="size-3.5 animate-spin" /> : "停用"}
        </Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}
