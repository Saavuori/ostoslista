import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle so the runtime container needs no node_modules.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  /**
   * Database drivers must not be bundled.
   *
   * PGlite ships a WASM payload it locates relative to its own file; bundling
   * rewrites that path to a build-time placeholder and it fails to load.
   * postgres-js is listed for the same class of reason.
   */
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  /**
   * Next 16 blocks cross-origin requests to dev resources by default, and
   * treats 127.0.0.1 as a different origin from localhost. The end-to-end
   * suite drives the app over a loopback address, so without this the client
   * bundle never loads and every interaction silently does nothing.
   *
   * Development only — it has no effect on a production build.
   */
  allowedDevOrigins: ["127.0.0.1", "localhost"],
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
