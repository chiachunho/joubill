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
