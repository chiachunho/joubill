import { execSync } from "child_process";

let appVersion = "dev";
try {
  appVersion = execSync("git describe --tags", { encoding: "utf8" }).trim();
} catch {
  // no tags yet or not a git repo — show "dev"
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
