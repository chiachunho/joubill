import type { Metadata } from "next";

import { helpPage } from "./help-pages";

export const SITE_NAME = "揪帳";
export const SITE_TITLE = "揪帳｜Telegram 分帳機器人";
export const SITE_DESCRIPTION =
  "聚餐、旅遊、下午茶，分帳就這樣搞定。在 Telegram 群組輸入 /add 記帳，自動算出誰欠誰、最少轉帳次數，支援多幣別與歷史匯率。";

/**
 * The site's origin, from `NEXT_PUBLIC_MINI_APP_URL` (the same source as `appUrl`; see help-url.ts).
 * Read from `process.env` rather than `clientEnv`, which throws when the variable is missing: a
 * build without it still works, it just emits relative URLs in the metadata.
 */
export function siteOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_MINI_APP_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** Metadata for a page that must stay out of search results (the apps, sign-in, invite links). */
export const NO_INDEX: Pick<Metadata, "robots"> = {
  robots: { index: false, follow: false },
};

/** `<title>`, description, canonical and social card for one help page (`page.mdx` exports it). */
export function helpMetadata(slug: string): Metadata {
  const { label, description } = helpPage(slug);
  const path = `/help/${slug}`;
  return {
    title: label,
    description,
    alternates: { canonical: path },
    openGraph: { type: "article", url: path, title: `${label}｜${SITE_NAME}說明`, description },
  };
}

/** JSON-LD for the landing page: what the product is, for search engines that read it. */
export function softwareApplicationJsonLd(origin: string | null) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web, Telegram",
    inLanguage: "zh-Hant",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "TWD" },
    ...(origin ? { url: origin } : {}),
  };
}

/** `<` would let a string value end the `<script>` early; JSON.stringify doesn't escape it. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
