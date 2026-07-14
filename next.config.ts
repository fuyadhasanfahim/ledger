import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

  // Typed <Link href> — dead internal links become build errors.
  typedRoutes: true,

  /**
   * Packages the bundler must leave alone and `require` at runtime instead.
   *
   * - `@sparticuz/chromium` unpacks a Chromium tarball from its own package
   *   directory. Bundled, that directory doesn't exist at runtime and the PDF
   *   route fails on Vercel with a missing-executable error.
   * - `puppeteer-core` resolves native/dynamic paths that don't survive bundling.
   * - `mongoose` pulls in optional native drivers (kerberos, snappy, …) which the
   *   bundler tries to follow and then warns/fails on. It's a server library;
   *   it has no business in the bundle graph.
   */
  serverExternalPackages: [
    "@sparticuz/chromium",
    "puppeteer-core",
    "mongoose",
  ],

  /**
   * Force Chromium into the receipt route's serverless bundle.
   *
   * `serverExternalPackages` keeps the bundler's hands off it, but that alone is
   * not enough on Vercel: the file tracer decides which files ship with each
   * function, and it cannot see through the *conditional dynamic* import in
   * src/server/pdf.ts (`await import("@sparticuz/chromium")` behind an
   * `isServerless` check). Nor can it see the Brotli-compressed binary the
   * package unpacks at runtime — that's data, not an import.
   *
   * The result is a function that deploys happily and then throws the instant
   * anyone asks for a PDF. So the files are pinned explicitly.
   *
   * The route key needs its brackets escaped — it's matched as a glob.
   */
  outputFileTracingIncludes: {
    "/api/receipt/\\[paymentId\\]": [
      "./node_modules/@sparticuz/chromium/**",
    ],
  },

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
