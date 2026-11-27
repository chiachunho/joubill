import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// `text-2xs` is a font size of our own (`@theme` in src/app/globals.css). Unregistered, tailwind-merge
// reads it as a text colour, and `cn("text-2xs", "text-primary")` silently drops it.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["2xs"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
