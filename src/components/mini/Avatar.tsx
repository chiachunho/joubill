type Props = {
  src?: string | null;
  name: string;
  userId: number;
  size?: "sm" | "md" | "lg";
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
    size === "sm" ? "size-6 text-[10px]" : size === "lg" ? "size-10 text-sm" : "size-8 text-xs";

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={`${sizeClass} rounded-full object-cover shrink-0`}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <span
      className={`${sizeClass} ${color} inline-flex items-center justify-center rounded-full font-medium text-white shrink-0`}
    >
      {initials || "?"}
    </span>
  );
}
