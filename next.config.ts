import path from "path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isDev = process.env.NODE_ENV === "development";

// Static (non-nonce) CSP: keeps pages statically rendered/cacheable, which
// matters more for this marketing site than nonce-level script isolation.
// 'unsafe-inline' on script-src is required in every environment, not just
// dev: Next's App Router streams the RSC payload and hydration bootstrap
// through inline <script> tags on every request, and without a nonce
// mechanism (which would force these pages off static rendering) the
// browser blocks those tags outright, breaking hydration for the whole
// site. 'unsafe-eval' stays dev-only since it's only needed for Turbopack's
// dev-time module runtime.
const cspDirectives = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://www.google-analytics.com",
  "font-src 'self'",
  "connect-src 'self' https://www.google-analytics.com https://analytics.google.com https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
];

const securityHeaders = [
  { key: "Content-Security-Policy", value: cspDirectives.join("; ") },
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
    value:
      "camera=(), microphone=(), geolocation=(), browsing-topics=(), interest-cohort=()",
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
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
