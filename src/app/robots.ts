import type { MetadataRoute } from "next";

import { siteOrigin } from "@/lib/seo";

/**
 * Only the landing page and the help site are for search engines. The apps, sign-in, invite
 * links and the API have nothing to index (and an invite link is a credential).
 */
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/help"],
      disallow: ["/api/", "/app", "/mini", "/login", "/join/"],
    },
    ...(origin ? { sitemap: `${origin}/sitemap.xml`, host: origin } : {}),
  };
}
