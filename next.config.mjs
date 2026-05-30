/** @type {import('next').NextConfig} */
const nextConfig = {
  // resvg-js ships a native .node binary that webpack can't bundle; keep it
  // external so it's required at runtime from node_modules.
  serverExternalPackages: ["@resvg/resvg-js"],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
