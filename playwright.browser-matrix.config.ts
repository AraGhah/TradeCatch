import base from "./playwright.local.config";
import { defineConfig } from "@playwright/test";

// Uses the existing isolated localhost harness, never live providers.
export default defineConfig({
  ...base,
  testMatch: /mobile-browser-matrix\.spec\.ts/,
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
