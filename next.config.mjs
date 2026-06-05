import { execSync } from "child_process";

let appVersion = "dev";
try {
  appVersion = execSync("git describe --tags --always", { encoding: "utf8" }).trim();
} catch {
  // not a git repo or no tags yet
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
