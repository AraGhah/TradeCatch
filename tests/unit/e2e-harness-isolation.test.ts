import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import playwrightConfig from "../../playwright.config";

/**
 * The browser tests boot a database-less server. A developer checkout keeps PRODUCTION values in
 * `.env.local`, and Next loads that file for `next build` / `next start`. Blanking a hand-picked list of
 * names let dozens of others through (live provider keys, and SAAS_REQUIRE_DURABLE=1, which made every
 * test fail with a 500 on its first write). The harness now sets `__NEXT_PROCESSED_ENV`, which makes
 * @next/env skip every dotenv file. That flag is internal to Next, so this test checks the behaviour on
 * the installed version and fails loudly if an upgrade changes it.
 *
 * The `.env.local` used here is synthetic: a sentinel and the one real flag name, never a real value.
 */
const SENTINEL = "leaked-from-env-local";

const CHILD = `
const { loadEnvConfig } = require(process.env.NEXT_ENV_MODULE);
loadEnvConfig(process.env.NEXT_ENV_DIR, false);
process.stdout.write(JSON.stringify({
  sentinel: process.env.E2E_ISOLATION_SENTINEL ?? null,
  durable: process.env.SAAS_REQUIRE_DURABLE ?? null,
}));
`;

const requireFromRepo = createRequire(path.join(process.cwd(), "package.json"));

function webServerEnv(): Record<string, string> {
  const server = Array.isArray(playwrightConfig.webServer)
    ? playwrightConfig.webServer[0]
    : playwrightConfig.webServer;
  assert.ok(server, "playwright.config.ts must define a webServer");
  return server.env ?? {};
}

describe("e2e harness never reads a developer's .env files", () => {
  let dir = "";
  let script = "";

  before(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "tc-e2e-env-"));
    writeFileSync(
      path.join(dir, ".env.local"),
      `E2E_ISOLATION_SENTINEL=${SENTINEL}\nSAAS_REQUIRE_DURABLE=1\n`,
    );
    script = path.join(dir, "load-env.cjs");
    writeFileSync(script, CHILD);
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function loadEnvWith(flag: string | undefined) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      NEXT_ENV_MODULE: requireFromRepo.resolve("@next/env"),
      NEXT_ENV_DIR: dir,
    };
    delete env.E2E_ISOLATION_SENTINEL;
    delete env.SAAS_REQUIRE_DURABLE;
    if (flag === undefined) delete env.__NEXT_PROCESSED_ENV;
    else env.__NEXT_PROCESSED_ENV = flag;
    const out = execFileSync(process.execPath, [script], { env, encoding: "utf8" });
    return JSON.parse(out) as { sentinel: string | null; durable: string | null };
  }

  it("control: without the flag Next does load .env.local, so a leak would be detected", () => {
    const loaded = loadEnvWith(undefined);
    assert.equal(loaded.sentinel, SENTINEL);
    assert.equal(loaded.durable, "1");
  });

  it("the harness sets the flag for both `next build` and `next start`", () => {
    assert.ok(
      webServerEnv().__NEXT_PROCESSED_ENV,
      "playwright.config.ts must set __NEXT_PROCESSED_ENV in webServer.env",
    );
  });

  it("with the harness's flag, no value from .env.local reaches the server", () => {
    const loaded = loadEnvWith(webServerEnv().__NEXT_PROCESSED_ENV);
    assert.equal(loaded.sentinel, null);
    assert.equal(loaded.durable, null);
  });
});
