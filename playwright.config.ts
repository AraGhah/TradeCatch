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
/**
 * Synthetic administrators for tests/admin-dashboard.spec.ts. Roles live here, in
 * the operator-controlled list, exactly as in production: a plain entry is a
 * super administrator, "email:role" restricts it.
 */
const ADMIN_CONSOLE_ADMINS = [
  ...Array.from(
    { length: 30 },
    (_, index) => `adm-${String(index + 1).padStart(2, "0")}@example.test`,
  ),
  "adm-support@example.test:support",
  "adm-readonly@example.test:read_only",
].join(",");
/** Where tests/gmail.spec.ts serves its stand-in for Google. */
export const GMAIL_E2E_PORT = Number(
  process.env.TRADECATCH_GMAIL_E2E_PORT || 4010,
);
export const GCAL_E2E_PORT = Number(
  process.env.TRADECATCH_GCAL_E2E_PORT || 4011,
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
    // Keep idle connections open well past the pauses between a test's requests. With Node's 5 s default the
    // server closes a socket that Playwright's request client is about to reuse, which surfaces as a rare
    // "read ECONNRESET" in an otherwise correct test.
    command: `npx next build --webpack && npx next start --port ${E2E_PORT} --keepAliveTimeout 65000`,
    url: `${E2E_ORIGIN}/api/health`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(E2E_PORT),
      NEXT_PUBLIC_SITE_URL: E2E_ORIGIN,
      TRADECATCH_E2E: "1",
      // Never read .env, .env.local or .env.production.local, for `next build` or `next start`. A developer
      // checkout keeps PRODUCTION values there: blanking the few names listed below left dozens of others
      // (live Bland/OpenAI/Anthropic keys, SAAS_REQUIRE_DURABLE=1, ...) flowing into the test server, and
      // SAAS_REQUIRE_DURABLE=1 alone made every database-less test fail with a 500 on its first write.
      // @next/env skips every dotenv file when this flag is set (Next sets it itself for child processes);
      // tests/unit/e2e-harness-isolation.test.ts proves that on the installed Next.
      __NEXT_PROCESSED_ENV: "true",
      // The default harness exercises storage-disabled behavior. Never inherit
      // a developer's production database or provider keys from the shell.
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
      TRADECATCH_ADMIN_EMAILS:
        `sales-admin@example.test,installation-admin-en@example.test,installation-admin-fr@example.test,auth-session-admin@example.test,${ADMIN_CONSOLE_ADMINS}`,
      // A second approved frontend (CORS_ALLOWED_ORIGINS) for tests/cors.spec.ts;
      // the built-in development list already covers localhost:3000/3001/3100.
      CORS_ALLOWED_ORIGINS: "http://localhost:3101",
      // Never inherit a future production enforcement rollout into this harness.
      INSTALLATION_ENFORCEMENT: "off",
      INSTALLATION_CREDENTIAL: "",
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
      // Google Calendar: the app talks to tests/support/fake-google-calendar instead of Google.
      GOOGLE_CALENDAR_CLIENT_ID: "e2e-calendar-client-id",
      GOOGLE_CALENDAR_CLIENT_SECRET: "e2e-calendar-client-secret",
      GOOGLE_CALENDAR_REDIRECT_URI: `${E2E_ORIGIN}/api/calendar/oauth/callback`,
      GCAL_TEST_GOOGLE_BASE: `http://127.0.0.1:${GCAL_E2E_PORT}`,
    },
  },
  use: {
    baseURL: E2E_ORIGIN,
    ...devices["Desktop Chrome"],
    // Local Windows worktrees may use a system Chrome when Playwright's own
    // browser bundle is unavailable; CI keeps its installed Playwright browser.
    ...(process.env.TRADECATCH_E2E_CHROME_PATH
      ? { launchOptions: { executablePath: process.env.TRADECATCH_E2E_CHROME_PATH } }
      : {}),
  },
});
