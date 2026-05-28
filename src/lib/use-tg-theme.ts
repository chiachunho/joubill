"use client";

import { useEffect } from "react";

/**
 * Convert "#rrggbb" to Tailwind/shadcn's "<h> <s>% <l>%" HSL component string.
 */
export function hexToHslComponents(hex: string): string | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Map Telegram theme params (https://core.telegram.org/bots/webapps#themeparams)
 * onto shadcn's CSS variables. Some mappings are approximate — Telegram exposes
 * fewer slots than shadcn's design system uses, so multiple shadcn vars share
 * the same TG source.
 */
const MAPPING: Array<{ tg: string; css: string[] }> = [
  { tg: "bg_color", css: ["--background"] },
  { tg: "text_color", css: ["--foreground"] },
  { tg: "secondary_bg_color", css: ["--muted", "--accent", "--secondary"] },
  { tg: "hint_color", css: ["--muted-foreground"] },
  { tg: "button_color", css: ["--primary", "--ring"] },
  { tg: "button_text_color", css: ["--primary-foreground"] },
  { tg: "destructive_text_color", css: ["--destructive"] },
  { tg: "section_bg_color", css: ["--card", "--popover"] },
  { tg: "section_separator_color", css: ["--border", "--input"] },
];

function applyTheme(themeParams: Record<string, string | undefined>) {
  const root = document.documentElement;

  for (const { tg, css } of MAPPING) {
    const hex = themeParams[tg];
    if (!hex) continue;
    const hsl = hexToHslComponents(hex);
    if (!hsl) continue;
    for (const v of css) root.style.setProperty(v, hsl);
  }

  // card / popover foreground follow text_color when not separately provided.
  if (themeParams.text_color) {
    const fg = hexToHslComponents(themeParams.text_color);
    if (fg) {
      root.style.setProperty("--card-foreground", fg);
      root.style.setProperty("--popover-foreground", fg);
      root.style.setProperty("--secondary-foreground", fg);
      root.style.setProperty("--accent-foreground", fg);
    }
  }
}

/**
 * On mount: read Telegram WebApp.themeParams and project them onto shadcn's
 * CSS variables; toggle the `.dark` class to match WebApp.colorScheme so any
 * `dark:` Tailwind utilities also respond. Re-applies on TG's `themeChanged`.
 */
export function useTelegramTheme() {
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      const { default: WebApp } = await import("@twa-dev/sdk");
      if (cancelled) return;

      const update = () => {
        applyTheme(WebApp.themeParams as unknown as Record<string, string | undefined>);
        document.documentElement.classList.toggle("dark", WebApp.colorScheme === "dark");
      };

      update();
      WebApp.onEvent("themeChanged", update);
      cleanup = () => WebApp.offEvent("themeChanged", update);
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);
}
