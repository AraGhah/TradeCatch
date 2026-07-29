import { defineConfig, devices } from "@playwright/test";

/** Dedicated E2E port — never collide with a random local `next dev` on 3000. */
export const E2E_PORT = Number(process.env.TRADECATCH_E2E_PORT || 3100);
export const E2E_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;

/**
 * Playwright boots a production server on a reserved port.
 * Never reuse an unrelated process on 3000 (reuseExistingServer is off).
 * Readiness requires the TradeCatch health marker, not just any HTTP 200.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  webServer: {
    command: `npm run build && npx next start --hostname 127.0.0.1 --port ${E2E_PORT}`,
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
