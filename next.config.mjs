import { readFileSync } from "fs";
import createMDX from "@next/mdx";

// The app version shown in Settings is the semver from package.json, bumped and
// tagged (v<version>) by the dev→main release workflow
// (.github/workflows/merge-dev-to-main.yml). Read from the file so it needs no
// git access at build time — Vercel's build has no credentials to resolve tags,
// and the deployed commit predates its own tag anyway.
let appVersion = "dev";
try {
  const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  if (pkg.version) appVersion = `v${pkg.version}`;
} catch {
  // package.json unreadable — leave the "dev" default.
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  pageExtensions: ["js", "jsx", "ts", "tsx", "md", "mdx"],
  // The service worker must be revalidated on every visit, or a fix to it waits for the
  // browser's own 24h check (public/sw.js).
  async headers() {
    return [
      {
        // Baseline for every response. No frame-ancestors/CSP here: the Mini App has to be
        // embeddable by Telegram's own clients.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // The standalone web app never needs to be framed (clickjacking on the sign-in and
        // join-by-invite screens). /mini stays embeddable.
        source: "/:prefix(app|login|join)/:path*",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
  // Help pages that were merged or renamed (src/app/help/layout.tsx). Old links live on in
  // chat history and shared URLs, so they keep working. A #fragment survives the redirect.
  async redirects() {
    return [
      { source: "/help/group-management", destination: "/help/members", permanent: true },
      { source: "/help/invite-members", destination: "/help/members", permanent: true },
      { source: "/help/web-app", destination: "/help/account", permanent: true },
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

// Plugins are passed by package name, not imported. Turbopack (`pnpm dev`)
// serialises the loader options, and a function is not serialisable — it fails
// with "does not have serializable options". @next/mdx resolves the strings
// from the project root itself, so the same config works under both Turbopack
// and webpack (production build).
const withMDX = createMDX({
  options: {
    remarkPlugins: ["remark-gfm"],
    rehypePlugins: ["rehype-slug"],
  },
});

export default withMDX(nextConfig);
