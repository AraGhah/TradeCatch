import { defineConfig, devices } from "@playwright/test";

/** Dedicated E2E port — never collide with a random local `next dev` on 3000. */
export const E2E_PORT = Number(process.env.TRADECATCH_E2E_PORT || 3100);
/**
 * Use `localhost`, not `127.0.0.1`.
 *
 * Next.js 16.2.6+ normalizes loopback hosts to `localhost` inside proxy/middleware
 * rewrites, but builds `initUrl` from the literal bind hostname. Binding or
 * requesting via `127.0.0.1` makes those origins disagree, so next-intl's
 * internal locale/pathname rewrites leak as 307 self-redirects
 * (`ERR_TOO_MANY_REDIRECTS`). See vercel/next.js#94745.
 */
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;
/** Where tests/gmail.spec.ts serves its stand-in for Google. */
export const GMAIL_E2E_PORT = Number(
  process.env.TRADECATCH_GMAIL_E2E_PORT || 4010,
);

/**
 * Playwright boots a production server on a reserved port.
 * Never reuse an unrelated process on 3000 (reuseExistingServer is off).
 * Readiness requires the TradeCatch health marker, not just any HTTP 200.
 * Do not pass `--hostname 127.0.0.1` (see E2E_ORIGIN comment above).
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  webServer: {
    command: `npm run build && npx next start --port ${E2E_PORT}`,
    url: `${E2E_ORIGIN}/api/health`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(E2E_PORT),
      NEXT_PUBLIC_SITE_URL: E2E_ORIGIN,
      TRADECATCH_E2E: "1",
      // The default harness exercises storage-disabled behavior. Never inherit
      // a developer's production database or provider keys from .env.local.
      DATABASE_URL: "",
      MISSED_CALL_DURABLE_STORE: "",
      SAAS_DURABLE_STORE: "",
      ERROR_WEBHOOK_URL: "",
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
      TURNSTILE_SECRET_KEY: "",
      RESEND_API_KEY: "",
      TWILIO_ACCOUNT_SID: "",
      TWILIO_AUTH_TOKEN: "",
      LEADS_WEBHOOK_URL: "",
      ELEVENLABS_API_KEY: "",
      RECEPTIONIST_ENABLED: "0",
      RECEPTIONIST_CONFIG_JSON: "",
      GOOGLE_CALENDAR_PILOT_ORG_IDS: "",
      STRIPE_SECRET_KEY: "",
      STRIPE_TEST_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      STRIPE_TEST_WEBHOOK_SECRET: "",
      AUTH_SECRET: "tradecatch-e2e-session-secret-not-for-production",
      SAAS_DEV_LOGIN: "1",
      // Synthetic platform identity for exercising real admin MFA/session gates.
      TRADECATCH_ADMIN_EMAILS: "sales-admin@example.test",
      MISSED_CALL_OPS_SECRET: "tradecatch-e2e-ops-secret-not-for-production",
      // Gmail: the app talks to tests/support/fake-google instead of Google.
      GOOGLE_GMAIL_CLIENT_ID: "e2e-gmail-client-id",
      GOOGLE_GMAIL_CLIENT_SECRET: "e2e-gmail-client-secret",
      GOOGLE_GMAIL_REDIRECT_URI: `${E2E_ORIGIN}/api/app/gmail/callback`,
      GMAIL_TEST_GOOGLE_BASE: `http://127.0.0.1:${GMAIL_E2E_PORT}`,
      GMAIL_TEST_MIN_GAP_MS: "300",
      GMAIL_PUSH_AUDIENCE: `${E2E_ORIGIN}/api/webhooks/gmail`,
      GMAIL_PUSH_SERVICE_ACCOUNT: "gmail-push@e2e.iam.gserviceaccount.com",
      GMAIL_PUBSUB_TOPIC: "projects/e2e/topics/gmail",
    },
  },
  use: {
    baseURL: E2E_ORIGIN,
    ...devices["Desktop Chrome"],
  },
});
