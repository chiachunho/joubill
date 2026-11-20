import type { SVGProps } from "react";

/**
 * The refund mark (issue #178): a banknote with an arrow pointing down, "money coming
 * back". Lucide's `BanknoteArrowDown`, drawn here because the installed lucide-react
 * predates it; same 24-unit grid and stroke as the other lucide icons, so `className`
 * sizes and colours it the same way (`size-3`, `text-muted-foreground`).
 */
export function RefundIcon({ className, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      <path d="M12 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5" />
      <path d="m16 19 3 3 3-3" />
      <path d="M18 12h.01" />
      <path d="M19 16v6" />
      <path d="M6 12h.01" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}
