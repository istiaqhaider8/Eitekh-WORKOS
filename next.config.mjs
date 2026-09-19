/** @type {import('next').NextConfig} */
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

// Baseline security headers applied to every response. CSP is intentionally
// conservative but permits Next.js's inline runtime; tighten to nonces later.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig = {
  /**
   * Phase 2 — emit a self-contained server.
   *
   * `next start` needs the whole repository present: node_modules, the source
   * tree, the lockfile. That makes "deploy" mean "clone and npm ci on the
   * target", which is slow, needs network at deploy time, and can resolve a
   * different dependency tree than the one that was tested.
   *
   * `standalone` traces the files the server actually imports and writes them
   * to .next/standalone, with a minimal node_modules beside them. The result
   * runs with `node server.js` and nothing else — which is what makes a small
   * container image possible, and what makes the artifact identical between
   * the machine that built it and the machine that runs it.
   *
   * Static assets are NOT traced into it: .next/static and public/ have to be
   * copied alongside, which is the one thing everybody gets wrong the first
   * time. The Dockerfile does it explicitly.
   */
  output: "standalone",

  /**
   * What must NOT be traced into the standalone output.
   *
   * The first build with `standalone` produced 766 MB and copied the whole
   * project root — every markdown file, the test scripts, `scratch/`, and,
   * worst of all, `storage/`, which is where local-fs attachments live. A
   * container image built from that would ship customer uploads inside a
   * layer, and deleting a file in a later instruction does not remove it from
   * the layer that added it.
   *
   * The heavy entries below are devDependencies that tracing pulls in through
   * a config file or a dynamic require but which the server never executes:
   * a browser driver and an accessibility engine have no business in a
   * production image.
   *
   * Keyed by route glob; `/**` applies to every entry point.
   */
  outputFileTracingExcludes: {
    "/**": [
      // User data. The reason this list exists.
      "./storage/**",
      "./backups/**",
      "./pgdata/**",

      // Repository furniture the runtime never reads.
      "./__tests__/**",
      "./docs/**",
      "./scratch/**",
      "./.github/**",
      "./*.md",
      "./test-*.js",
      "./tsconfig.tsbuildinfo",

      // Build- and test-time only.
      "./node_modules/playwright-core/**",
      "./node_modules/@axe-core/**",
      "./node_modules/axe-core/**",
      "./node_modules/jest/**",
      "./node_modules/ts-jest/**",
      "./node_modules/@swc/**",
      "./node_modules/typescript/**",
      "./node_modules/eslint/**",
      "./node_modules/@typescript-eslint/**",
      "./node_modules/@next/bundle-analyzer/**",
      "./node_modules/webpack-bundle-analyzer/**",

      // Prisma ships an engine per platform; the image needs one.
      "./node_modules/@prisma/engines/**",
      "./node_modules/prisma/**",
    ],
  },

  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  images: {
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
