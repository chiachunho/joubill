import { execSync } from "child_process";
import { readFileSync } from "fs";

// Released builds carry the release tag in package.json `appVersion`, written by
// the dev→main release workflow (.github/workflows/merge-dev-to-main.yml). We
// read it from the file rather than from git tags because Vercel's build has no
// git credentials to fetch tags, and the deployed commit predates its own tag.
let appVersion = "dev";
try {
  const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  if (pkg.appVersion) appVersion = pkg.appVersion;
} catch {
  // package.json unreadable — leave the "dev" default.
}

// Local/unreleased builds have appVersion "dev"; fall back to git so developers
// still see a meaningful version. (No-op on Vercel, where appVersion is set.)
if (appVersion === "dev") {
  try {
    appVersion = execSync("git describe --tags --always", { encoding: "utf8" }).trim();
  } catch {
    // not a git repo — keep "dev".
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
