import type { MetadataRoute } from "next";

import { HELP_PAGES } from "@/lib/help-pages";
import { siteOrigin } from "@/lib/seo";

/** The landing page and every help page (`HELP_PAGES`). Nothing behind a login belongs here. */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin() ?? "";
  return [
    { url: `${origin}/`, changeFrequency: "monthly", priority: 1 },
    ...HELP_PAGES.map((p) => ({
      url: `${origin}/help/${p.slug}`,
      changeFrequency: "monthly" as const,
      priority: p.slug === "getting-started" ? 0.9 : 0.6,
    })),
  ];
}
