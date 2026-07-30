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
    },
  },
  use: {
    baseURL: E2E_ORIGIN,
    ...devices["Desktop Chrome"],
  },
});
