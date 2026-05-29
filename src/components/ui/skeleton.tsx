import { cn } from "@/lib/utils";

/** A single pulsing placeholder block. Compose these into page-shaped skeletons. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-foreground/[0.08]", className)} />;
}
