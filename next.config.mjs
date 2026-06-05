import { execSync } from "child_process";

let appVersion = "dev";
try {
  appVersion = execSync("git describe --tags", { encoding: "utf8" }).trim();
} catch {
  // no tags — fall back to short commit SHA
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
