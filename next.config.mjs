import { execSync } from "child_process";

let appVersion = "dev";
try {
  // Vercel does a shallow clone without tags, so `git describe --tags` finds
  // none and falls through to the SHA. Pull tags in first (best-effort), and
  // deepen the history (--unshallow) so describe can reach a tag that precedes
  // HEAD — not just one sitting exactly on it. timeout bounds a stalled fetch.
  try {
    execSync("git fetch --tags --unshallow", { stdio: "ignore", timeout: 15000 });
  } catch {
    // already a complete clone (--unshallow errors), offline, or no remote —
    // fall back to a plain tag fetch; describe still works if tags are present.
    try {
      execSync("git fetch --tags", { stdio: "ignore", timeout: 15000 });
    } catch {
      // offline / no remote — proceed with whatever tags are already local.
    }
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
