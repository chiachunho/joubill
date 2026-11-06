"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { ACCESS_HINT, ACCESS_LABEL } from "@/lib/mcp-ui";
import { cn } from "@/lib/utils";

/** 權限: 唯讀 or 可記帳. A two-way choice, so a segmented control rather than a select. */
export function McpAccessPicker({
  value,
  onChange,
}: {
  value: "read" | "write";
  onChange: (value: "read" | "write") => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted-foreground">權限</p>
      <div
        role="radiogroup"
        aria-label="權限"
        className="grid grid-cols-2 gap-1 rounded-lg bg-secondary/60 p-1"
      >
        {(["read", "write"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "rounded-md py-1.5 text-sm transition-colors",
              value === v ? "bg-background font-semibold shadow-sm" : "text-muted-foreground",
            )}
          >
            {ACCESS_LABEL[v]}
          </button>
        ))}
      </div>
      <p className="mt-1.5 px-0.5 text-xs text-muted-foreground">{ACCESS_HINT[value]}</p>
    </div>
  );
}

export type Scope = { allGroups: boolean; groupIds: number[] };

/**
 * 可以存取的群組: one box per group and 所有群組，含之後加入的. Ticking the latter is the
 * wider grant, so it starts off and only the person turns it on.
 */
export function McpScopePicker({
  groups,
  value,
  onChange,
}: {
  groups: { id: number; title: string; defaultCurrency: string }[];
  value: Scope;
  onChange: (value: Scope) => void;
}) {
  function toggle(id: number, on: boolean) {
    const next = on ? [...value.groupIds, id] : value.groupIds.filter((g) => g !== id);
    onChange({ ...value, groupIds: next });
  }

  return (
    <div>
      <p className="mb-1.5 text-xs text-muted-foreground">可以存取的群組</p>
      <div className="divide-y divide-border/40 overflow-hidden rounded-lg bg-secondary/50">
        {groups.map((g) => (
          <label key={g.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
            <Checkbox
              checked={value.allGroups || value.groupIds.includes(g.id)}
              disabled={value.allGroups}
              onCheckedChange={(on) => toggle(g.id, on === true)}
            />
            <span className="min-w-0 flex-1 truncate">{g.title}</span>
            <span className="text-xs text-muted-foreground">{g.defaultCurrency}</span>
          </label>
        ))}
        <label className="flex items-center gap-3 px-3 py-2.5 text-sm">
          <Checkbox
            checked={value.allGroups}
            onCheckedChange={(on) => onChange({ allGroups: on === true, groupIds: value.groupIds })}
          />
          <span>所有群組，含之後加入的</span>
        </label>
      </div>
    </div>
  );
}

/** Whether a scope names anything at all, which the server requires. */
export function scopeIsValid(s: Scope): boolean {
  return s.allGroups || s.groupIds.length > 0;
}
