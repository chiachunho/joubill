import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { IconTile } from "@/components/mini/IconTile";

/**
 * A row that does something when tapped (download, send): icon tile and label, no chevron.
 * Like `NavRow` it renders the bare row, so put it inside a panel that owns the rounding and
 * the dividers.
 */
export function ActionRow({
  icon,
  onClick,
  disabled,
  children,
}: {
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30 active:bg-accent/50 disabled:opacity-50"
    >
      <IconTile icon={icon} />
      <p className="min-w-0 flex-1 text-sm">{children}</p>
    </button>
  );
}
