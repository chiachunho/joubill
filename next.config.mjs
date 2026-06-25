import { execSync } from "child_process";

let appVersion = "dev";
try {
  // Vercel does a shallow clone without tags, so `git describe --tags` finds
  // none and falls through to the SHA. Pull tags in first (best-effort) so we
  // can show the real tag name when one points at (or precedes) HEAD.
  try {
    execSync("git fetch --tags --depth=1", { stdio: "ignore" });
  } catch {
    // offline / no remote — describe still works if tags are already present
  }
  // --always guarantees a SHA fallback when truly no tag is reachable.
  appVersion = execSync("git describe --tags --always", { encoding: "utf8" }).trim();
} catch {
  // not a git repo — fall back to short commit SHA
  try {
    appVersion = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    // not a git repo
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
