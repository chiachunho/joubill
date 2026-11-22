"use client";

import { useState, type ReactNode } from "react";

type AvatarSize = "xs" | "sm" | "md" | "lg";

type Props = {
  src?: string | null;
  name: string;
  /** Picks the initials' colour. */
  userId: number;
  size?: AvatarSize;
  /**
   * Drawn instead of the initials when there is no picture, or it fails to load (a
   * person's own avatar uses an icon). Sized and rounded by the caller.
   */
  fallback?: ReactNode;
};

/**
 * Circle size and the size of the letters inside it. The letters follow the circle, so the
 * two smallest are below the design system's type scale on purpose; this is the only
 * place such sizes are allowed (docs/design-system.md §3).
 */
const SIZE_CLASS: Record<AvatarSize, string> = {
  xs: "size-5 text-[9px]",
  sm: "size-7 text-[10px]",
  md: "size-9 text-xs",
  lg: "size-12 text-sm",
};

const COLORS = [
  "bg-rose-400",
  "bg-orange-400",
  "bg-amber-400",
  "bg-green-500",
  "bg-teal-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-pink-500",
];

/**
 * A person's or a group's round picture, falling back to coloured initials. Every avatar
 * in the app is this component, so a photo that fails to load (an expired Telegram file,
 * a revoked provider picture) shows the initials instead of a broken image or a gap.
 */
export function Avatar({ src, name, userId, size = "md", fallback }: Props) {
  const [failed, setFailed] = useState<string | null>(null);
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const color = COLORS[userId % COLORS.length];
  const sizeClass = SIZE_CLASS[size];

  if (src && failed !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        referrerPolicy="no-referrer"
        className={`${sizeClass} shrink-0 rounded-full object-cover ring-1 ring-black/10 dark:ring-white/10`}
        onError={() => setFailed(src)}
      />
    );
  }
  if (fallback) return <>{fallback}</>;
  return (
    <span
      className={`${sizeClass} ${color} inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white`}
    >
      {initials || "?"}
    </span>
  );
}

/** The "+N" circle after a stack of avatars, sized like the avatars it follows. */
export function AvatarOverflow({ count, size = "md" }: { count: number; size?: AvatarSize }) {
  return (
    <span
      className={`${SIZE_CLASS[size]} inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground ring-2 ring-background`}
    >
      +{count}
    </span>
  );
}
