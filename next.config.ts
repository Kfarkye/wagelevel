import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.wagelevel.fyi" }],
        destination: "https://wagelevel.fyi/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
