import base, { E2E_PORT } from "./playwright.config";

// Temporary: reuse the build already on disk instead of rebuilding.
const config = {
  ...base,
  webServer: {
    ...base.webServer,
    command: `npx next start --port ${E2E_PORT}`,
    timeout: 120_000,
  },
};

export default config;
