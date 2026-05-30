/**
 * Hex equivalents of the design-system tokens (light theme), for use inside
 * satori-rendered cards. The bot can't read a user's Telegram theme, so cards
 * always render in the light brand palette.
 *
 * Keep these in sync with globals.css :root and Avatar.tsx.
 */
export const CARD = {
  background: "#F2F0EB", // 米白 --background
  foreground: "#1A1A1A", // 墨黑 --foreground
  panel: "#FFFFFF", // --card
  muted: "#707070", // --muted-foreground (0 0% 44%)
  border: "#E4DFD5", // --border (43 12% 84%)
  primary: "#2EBD8F", // 揪綠 --primary
  gold: "#F5B731", // 帳金 --brand-gold
  positive: "#10B981", // emerald-500
  negative: "#F43F5E", // rose-500
} as const;

/** Avatar fallback colour palette — must match Avatar.tsx COLORS order. */
export const AVATAR_COLORS = [
  "#FB7185", // rose-400
  "#FB923C", // orange-400
  "#FBBF24", // amber-400
  "#22C55E", // green-500
  "#14B8A6", // teal-500
  "#0EA9E9", // sky-500
  "#8B5CF6", // violet-500
  "#EC4899", // pink-500
] as const;

export function avatarColor(userId: number): string {
  return AVATAR_COLORS[userId % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  return (
    name
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}
