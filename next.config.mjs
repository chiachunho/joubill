import { readFileSync } from "fs";
import createMDX from "@next/mdx";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";

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

const withMDX = createMDX({
  options: {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [rehypeSlug],
  },
});

export default withMDX(nextConfig);
