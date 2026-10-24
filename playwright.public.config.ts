import { defineConfig } from "@playwright/test";

// Explicit opt-in command; never submits data or starts the local test server.
export default defineConfig({
  testDir: "./tests",
  testMatch: /public-browser\.live\.ts/,
  timeout: 60000,
  retries: 0,
  workers: 2,
  use: { baseURL: "https://tradecatch.ca", browserName: "chromium" },
});
