import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * One choice of a short pick-one list where each choice needs room (a person to claim, an
 * account to keep, what to do with some records): a bordered `rounded-lg` card around a
 * native radio, tinted when chosen. Group them in a `<fieldset>` with a `<legend>`.
 * With `hint`, the label sits above a line of muted detail.
 */
export function RadioCard({
  name,
  checked,
  onChange,
  disabled,
  hint,
  className,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer gap-3 rounded-lg border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/5",
        hint ? "items-start" : "items-center",
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className={hint ? "mt-1" : undefined}
      />
      {hint ? (
        <span className="min-w-0 flex-1">
          {children}
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
      ) : (
        children
      )}
    </label>
  );
}
