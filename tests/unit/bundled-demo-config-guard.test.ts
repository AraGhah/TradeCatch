import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { isReservedDemoPhone as appIsReservedDemoPhone } from "../../src/product/missed-call/client-config";

const require = createRequire(import.meta.url);
const {
  isReservedDemoPhone,
  findDemoRouting,
  assertNoBundledDemoConfig,
  checkBundledDemoConfigFile,
} = require("../../scripts/check-bundled-demo-config.js");

function bundle(production: Record<string, string>, development = production) {
  return [
    `export const production = ${JSON.stringify(production)};`,
    `export const development = ${JSON.stringify(development)};`,
    "export const test = {};",
    "",
  ].join("\n");
}

/** Non-secret part of the OpenNext fallback that shipped on 2026-10-25. */
const OCT_25_PRODUCTION = {
  TRADECATCH_ENV: "production",
  MISSED_CALL_DURABLE_STORE: "1",
  MISSED_CALL_CLIENT_ID: "client_demo",
  MISSED_CALL_SMS_FROM: "+15145550100",
  MISSED_CALL_TECH_PHONE: "+15145550199",
  MISSED_CALL_HUMAN_REVIEW_PHONE: "",
  MISSED_CALL_TECH_OWNER_PHONE: "",
  RECEPTIONIST_ENABLED: "1",
  RECEPTIONIST_LLM_TIMEOUT_MS: "4500",
};

const CLEAN_PRODUCTION = {
  TRADECATCH_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://tradecatch.ca",
  MISSED_CALL_DURABLE_STORE: "1",
  MISSED_CALL_TIMEZONE: "America/Toronto",
  MISSED_CALL_ALLOW_DEMO: "",
  RECEPTIONIST_PHONE_NUMBER: "+14382314700",
  RECEPTIONIST_FALLBACK_PHONE: "+14385597004",
  RECEPTIONIST_LLM_TIMEOUT_MS: "4500",
  RECEPTIONIST_CONFIG_JSON: "",
};

test("the release guard's 555 rule matches the app's isReservedDemoPhone", () => {
  const numbers = [
    "+15145550100",
    "+15145550199",
    "+15145550288",
    "+15145550377",
    "+15145550121",
    "+14165551234",
    "+1 (514) 555-0100",
    "5145550100",
    "+14382314700",
    "+14385597004",
    "+15145559876",
    "+33155501234",
    "+14165550000",
  ];
  for (const n of numbers)
    assert.equal(isReservedDemoPhone(n), appIsReservedDemoPhone(n), n);
});

test("blocks the 2026-10-25 bundle, naming keys but never values", () => {
  assert.throws(
    () => assertNoBundledDemoConfig(bundle(OCT_25_PRODUCTION)),
    (err: Error) => {
      assert.match(err.message, /^Release blocked/);
      assert.match(err.message, /MISSED_CALL_CLIENT_ID \(demo client id\)/);
      assert.match(err.message, /MISSED_CALL_SMS_FROM \(reserved 555 demo number\)/);
      assert.match(err.message, /MISSED_CALL_TECH_PHONE \(reserved 555 demo number\)/);
      assert.doesNotMatch(err.message, /5145550|client_demo"/);
      return true;
    },
  );
});

test("lets a clean production bundle through", () => {
  assert.deepEqual(findDemoRouting(CLEAN_PRODUCTION), []);
  assert.doesNotThrow(() => assertNoBundledDemoConfig(bundle(CLEAN_PRODUCTION)));
});

test("finds demo routing inside JSON configs and the demo bypass flag", () => {
  const issues = findDemoRouting({
    MISSED_CALL_ALLOW_DEMO: "1",
    MISSED_CALL_CLIENT_CONFIG_JSON: JSON.stringify({
      id: "client_x",
      smsFromNumber: "+14382314700",
      technicianRoster: [{ id: "t", phone: "+15145550288" }],
    }),
    RECEPTIONIST_CONFIG_JSON: JSON.stringify([
      { id: "rc_a", clientAccountId: "client_demo", phoneNumberE164: "+14382314700" },
    ]),
  });
  assert.deepEqual(issues, [
    "MISSED_CALL_ALLOW_DEMO (demo routing bypass enabled)",
    "MISSED_CALL_CLIENT_CONFIG_JSON (reserved 555 demo number)",
    "RECEPTIONIST_CONFIG_JSON (demo client id)",
  ]);
});

test("ignores keys that do not configure call routing", () => {
  assert.deepEqual(
    findDemoRouting({
      NEXT_PUBLIC_DEMO_PHONE: "+15145550100",
      SALES_DEMO_CLIENT: "client_demo",
    }),
    [],
  );
});

test("reads only the production fallback the Worker uses", () => {
  assert.doesNotThrow(() =>
    assertNoBundledDemoConfig(bundle(CLEAN_PRODUCTION, OCT_25_PRODUCTION)),
  );
  assert.throws(
    () => assertNoBundledDemoConfig("export const development = {};\n"),
    /no production export/,
  );
});

test("fails closed when the env module is missing", () => {
  assert.throws(
    () =>
      checkBundledDemoConfigFile("missing/next-env.mjs", {
        readFile: () => {
          throw new Error("ENOENT");
        },
      }),
    /Release blocked: missing OpenNext env module/,
  );
});

test("the production release runs the guard and staging skips it", () => {
  const source = readFileSync(
    path.join(process.cwd(), "scripts", "release-cloudflare.js"),
    "utf8",
  );
  assert.match(source, /require\("\.\/check-bundled-demo-config"\)/);
  assert.match(source, /if \(!staging\) checkBundledDemoConfigFile\(\);/);
  // After the build and strip, before anything is uploaded.
  assert.ok(
    source.indexOf("checkBundledDemoConfigFile();") >
      source.indexOf("stripBundledEnvFile();"),
  );
  assert.ok(
    source.indexOf("checkBundledDemoConfigFile();") <
      source.indexOf('import("./release-worker-artifact.mjs")'),
  );
});
