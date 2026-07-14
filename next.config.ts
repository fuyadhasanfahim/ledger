import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

  // Typed <Link href> — dead internal links become build errors.
  typedRoutes: true,

  // Prisma 7 uses a native driver adapter (pg); keep it out of the bundler so
  // server-side native resolution keeps working.
  serverExternalPackages: ["@prisma/adapter-pg", "pg"],

  images: {
    // Stripe-hosted product imagery is the only remote source we permit.
    remotePatterns: [{ protocol: "https", hostname: "files.stripe.com" }],
    formats: ["image/avif", "image/webp"],
  },

  poweredByHeader: false,

  // Static security headers. The CSP is set in proxy.ts instead, because it
  // carries a per-request nonce and cannot be static.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(self)",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
