import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle so the runtime container needs no node_modules.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // Product photos are hotlinked from Kesko's CDN rather than mirrored.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "public.keskofiles.com",
        pathname: "/f/k-ruoka/**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // The service worker must never be cached, or clients pin to a stale build.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
