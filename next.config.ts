import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "libsql"],
  poweredByHeader: false,
};

export default nextConfig;
