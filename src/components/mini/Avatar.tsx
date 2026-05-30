type Props = {
  src?: string | null;
  name: string;
  userId: number;
  size?: "xs" | "sm" | "md" | "lg";
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

export function Avatar({ src, name, userId, size = "md" }: Props) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const color = COLORS[userId % COLORS.length];
  const sizeClass =
    size === "xs"
      ? "size-5 text-[9px]"
      : size === "sm"
        ? "size-7 text-[10px]"
        : size === "lg"
          ? "size-12 text-sm"
          : "size-9 text-xs";

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className={`${sizeClass} rounded-full object-cover shrink-0 ring-1 ring-black/10 dark:ring-white/10`}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <span
      className={`${sizeClass} ${color} inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0`}
    >
      {initials || "?"}
    </span>
  );
}
