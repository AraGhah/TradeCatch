import path from "path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isDev = process.env.NODE_ENV === "development";

// Single document CSP for OpenNext Cloudflare. Do not use per-request nonces
// in middleware: asset/HTML nonce mismatch + 'strict-dynamic' blocks all JS.
// 'unsafe-inline' covers bootstrap + GA init inline scripts (no nonce path).
// Production script-src must NOT include 'unsafe-eval'.
const apiFallbackCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://www.google-analytics.com",
  "font-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'self' https://www.google-analytics.com https://analytics.google.com https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com https://cal.com https://calendly.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: apiFallbackCsp },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    // The receptionist demo listens through the visitor's microphone, so
    // this origin may ask for it. No embedded frame may, and nothing else.
    value:
      "camera=(), microphone=(self), geolocation=(), browsing-topics=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  // Purely a local-dev quality-of-life setting: hides the floating dev-tools
  // indicator badge. It never rendered in production (confirmed via a clean,
  // extension-free browser against the actual build output) — this only
  // stops it from being mistaken for a shipped UI element during development.
  devIndicators: false,
  turbopack: {
    root: path.join(__dirname),
  },
  // pg loads pg-cloudflare only under Cloudflare Workers; NFT traces the
  // default empty.js export, so esbuild then fails on workerd's dist/index.js.
  // See https://github.com/opennextjs/opennextjs-cloudflare/issues/1214
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/pg-cloudflare/dist/**",
      "./node_modules/pg-cloudflare/esm/**",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  // The receptionist page used to live under a different path. Keep old links,
  // bookmarks and search results working.
  async redirects() {
    return [
      {
        source: "/ai-receptionist",
        destination: "/receptionist",
        permanent: true,
      },
      {
        source: "/fr/receptionniste-ia",
        destination: "/fr/receptionniste",
        permanent: true,
      },
    ];
  },
};

export default withNextIntl(nextConfig);

// Local Cloudflare bindings. Production builds must not start workerd here:
// it would keep `.open-next/assets` open and the deploy cannot replace that folder.
if (process.argv.includes("dev")) {
  import("@opennextjs/cloudflare").then((mod) =>
    mod.initOpenNextCloudflareForDev({
      configPath: path.join(__dirname, "wrangler.dev.jsonc"),
    }),
  );
}
