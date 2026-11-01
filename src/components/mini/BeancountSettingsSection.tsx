"use client";

import { useState } from "react";
import { Check, ExternalLink, Loader2 } from "lucide-react";

import { BeancountSettingsSkeleton } from "@/components/mini/skeletons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiErrorText } from "@/lib/api-error";
import { BEANCOUNT_ACCOUNT_HINT, BEANCOUNT_ACCOUNT_RE, type BeancountConfigInput } from "@/lib/zod";
import { useGetBeancountConfigQuery, usePutBeancountConfigMutation } from "@/store/api";

const BEANCOUNT_PROJECT_URL = "https://github.com/beancount/beancount";

/**
 * Open an external link from either surface. Inside the Mini App's Telegram webview a
 * plain `<a>`/`window.open` would navigate the webview itself away rather than
 * opening a browser, so try `WebApp.openLink` first; outside Telegram the SDK call
 * itself falls back to `window.open`.
 */
function openExternal(url: string) {
  import("@twa-dev/sdk")
    .then(({ default: WebApp }) => WebApp.openLink(url))
    .catch(() => window.open(url, "_blank", "noopener"));
}

type Config = BeancountConfigInput;

const FIELDS: { key: keyof Config; label: string }[] = [
  { key: "expensesAccount", label: "Expenses 帳戶" },
  { key: "cashAccount", label: "Cash 帳戶" },
  { key: "eventAccount", label: "活動帳戶" },
];

function trimmed(c: Config): Config {
  return {
    expensesAccount: c.expensesAccount.trim(),
    cashAccount: c.cashAccount.trim(),
    eventAccount: c.eventAccount.trim(),
  };
}

function same(a: Config, b: Config): boolean {
  return FIELDS.every(({ key }) => a[key] === b[key]);
}

/**
 * The three accounts the group's beancount export writes, for the current user only.
 * The server always answers with every account filled in (defaults for anything never
 * saved), so there is nothing to switch on: the page is just the form.
 */
export function BeancountSettingsSection({ groupId }: { groupId: string }) {
  const { data, error } = useGetBeancountConfigQuery(groupId);

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
  return <Editor groupId={groupId} initial={data.config} />;
}

function Editor({ groupId, initial }: { groupId: string; initial: Config }) {
  const [putConfig] = usePutBeancountConfigMutation();
  const [values, setValues] = useState<Config>(initial);
  // What the server holds now. 儲存 is off while the form matches it, and 已儲存
  // stays up until the form changes again, so the label is always true.
  const [baseline, setBaseline] = useState<Config>(initial);
  const [savedOnce, setSavedOnce] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = (v: string) => BEANCOUNT_ACCOUNT_RE.test(v.trim());
  const dirty = !same(trimmed(values), baseline);
  const canSave = !saving && dirty && FIELDS.every(({ key }) => valid(values[key]));

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setErr(null);
    try {
      const { config } = await putConfig({ groupId, config: trimmed(values) }).unwrap();
      setBaseline(config);
      setValues(config);
      setSavedOnce(true);
    } catch (e) {
      setErr(apiErrorText(e, "儲存失敗，請再試一次"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="px-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          匯出 beancount 時，以你的角度記帳：你分攤的部分記到 Expenses 帳戶，你墊的錢記到 Cash
          帳戶，和群組其他人之間的差額都記到同一個活動帳戶，它的餘額就是你在這個群組的結餘。只影響你自己的匯出。{" "}
          <button
            type="button"
            onClick={() => openExternal(BEANCOUNT_PROJECT_URL)}
            className="inline-flex items-center gap-0.5 font-medium text-primary"
          >
            什麼是 beancount？
            <ExternalLink className="size-3" />
          </button>
        </p>
      </section>

      <section className="px-4">
        <div className="overflow-hidden rounded-2xl bg-secondary/50">
          <div className="space-y-3 px-4 py-3">
            {FIELDS.map(({ key, label }) => {
              const id = `beancount-${key}`;
              const ok = valid(values[key]);
              return (
                <div key={key} className="space-y-1">
                  <label htmlFor={id} className="text-xs text-muted-foreground">
                    {label}
                  </label>
                  <Input
                    id={id}
                    value={values[key]}
                    onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                    disabled={saving}
                    className={`h-8 rounded-lg border-0 bg-background/60 text-sm ${ok ? "" : "ring-1 ring-destructive"}`}
                  />
                  {!ok && <p className="text-xs text-destructive">{BEANCOUNT_ACCOUNT_HINT}</p>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="flex items-center gap-3 px-4">
        <Button type="button" size="sm" className="rounded-lg" disabled={!canSave} onClick={save}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : "儲存"}
        </Button>
        {savedOnce && !dirty && (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
            <Check className="size-3.5" />
            已儲存
          </span>
        )}
      </section>

      {err && <p className="px-4 text-sm text-destructive">{err}</p>}
    </>
  );
}
