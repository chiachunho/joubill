import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const TONES = {
  primary: "bg-primary/10 text-primary",
  muted: "bg-muted text-muted-foreground",
  destructive: "bg-destructive/10 text-destructive",
} as const;

/** The round icon at the start of a settings row. */
export function IconTile({
  icon: Icon,
  tone = "primary",
}: {
  icon: LucideIcon;
  tone?: keyof typeof TONES;
}) {
  return (
    <span
      className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", TONES[tone])}
    >
      <Icon className="size-3.5" />
    </span>
  );
}
