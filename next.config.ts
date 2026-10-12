import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverActions: { bodySizeLimit: "2mb" },
};

export default nextConfig;
