"use strict";

/**
 * Production release guard: refuse to ship demo call routing.
 *
 * OpenNext compiles every `.env*` file into `.open-next/cloudflare/next-env.mjs`
 * and the Worker applies those values whenever no Cloudflare binding exists.
 * On 2026-10-25 a local `.env.local` holding the demo client
 * (MISSED_CALL_CLIENT_ID=client_demo, 555 numbers, RECEPTIONIST_ENABLED=1)
 * shipped that way; production validation then refused it at boot and every
 * call got RECEPTIONIST_RUNTIME_UNAVAILABLE. `strip-bundled-env-secrets.js`
 * only removes credential-named keys, so these values passed through.
 *
 * This check runs after the build, on the "production" fallback the Worker
 * reads, and blocks the release instead of silently dropping values (dropping
 * them would change production configuration without anyone deciding to).
 * Staging is exempt: it runs on demo fixtures by design (wrangler.jsonc).
 *
 * Prints key names and reasons only, never values. Usage:
 *   node scripts/check-bundled-demo-config.js [.open-next/cloudflare/next-env.mjs]
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_PATH = path.join(".open-next", "cloudflare", "next-env.mjs");

/** Keys that configure call routing (Module A client and receptionist profiles). */
const ROUTING_KEY = /^(?:MISSED_CALL_|RECEPTIONIST_)/;

/** Same list as RESERVED_DEMO_PHONES in src/product/missed-call/client-config.ts. */
const RESERVED_DEMO_PHONES = new Set([
  "+15145550100",
  "+15145550199",
  "+15145550288",
  "+15145550377",
]);

/**
 * Mirror of `isReservedDemoPhone` (src/product/missed-call/client-config.ts);
 * tests/unit/bundled-demo-config-guard.test.ts keeps the two in agreement.
 */
function isReservedDemoPhone(phone) {
  const n = String(phone).replace(/[^\d+]/g, "");
  if (RESERVED_DEMO_PHONES.has(n)) return true;
  return /\+1\d{3}555\d{4}$/.test(n) || /^5145550/.test(n.replace(/^\+1/, ""));
}

/** Phone-like runs inside a value (plain or inside a JSON config). */
const PHONE_LIKE = /\+?\d[\d\s().-]{8,}\d/g;
const DEMO_CLIENT_ID = /\bclient_demo\b/;

/**
 * Reasons (never values) why one bundled env object would route production
 * calls to demo fixtures. Empty when it is safe.
 */
function findDemoRouting(env) {
  if (!env || typeof env !== "object" || Array.isArray(env))
    throw new Error("Bundled env mode must be a plain object.");
  const issues = [];
  for (const [key, raw] of Object.entries(env)) {
    if (!ROUTING_KEY.test(key) || typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value) continue;
    if (key === "MISSED_CALL_ALLOW_DEMO" && value === "1") {
      issues.push(`${key} (demo routing bypass enabled)`);
      continue;
    }
    if (DEMO_CLIENT_ID.test(value)) issues.push(`${key} (demo client id)`);
    const phones = value.match(PHONE_LIKE) ?? [];
    if (phones.some(isReservedDemoPhone))
      issues.push(`${key} (reserved 555 demo number)`);
  }
  return issues;
}

const PRODUCTION_EXPORT = /^export const production = (\{[\s\S]*?\});$/m;

/** Throws with a key-name-only message when the production fallback carries demo routing. */
function assertNoBundledDemoConfig(source) {
  if (typeof source !== "string")
    throw new Error("Bundled env module source must be a string.");
  const match = PRODUCTION_EXPORT.exec(source);
  if (!match)
    throw new Error(
      "Release blocked: no production export in the OpenNext env fallback (next-env.mjs).",
    );
  let env;
  try {
    env = JSON.parse(match[1]);
  } catch {
    throw new Error(
      'Release blocked: could not parse bundled env for mode "production".',
    );
  }
  const issues = findDemoRouting(env);
  if (issues.length > 0)
    throw new Error(
      [
        "Release blocked: the OpenNext env fallback (compiled from .env* files) would route production calls to demo fixtures:",
        ...issues.map((issue) => `  - ${issue}`),
        "Remove or comment out these lines in .env.local / .env.production.local before deploying.",
        "Real business routing belongs in Worker variables or tenant profiles, not local env files.",
      ].join("\n"),
    );
  return { checked: Object.keys(env).length };
}

function checkBundledDemoConfigFile(
  filePath = DEFAULT_PATH,
  { readFile = fs.readFileSync } = {},
) {
  let source;
  try {
    source = readFile(path.resolve(filePath), "utf8");
  } catch {
    throw new Error(
      `Release blocked: missing OpenNext env module at ${filePath}. Run the Cloudflare build first.`,
    );
  }
  const result = assertNoBundledDemoConfig(source);
  console.log(`OpenNext env fallback has no demo call routing (${filePath}).`);
  return result;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length > 1) {
    console.error(
      "Usage: node scripts/check-bundled-demo-config.js [path/to/next-env.mjs]",
    );
    process.exitCode = 1;
  } else {
    try {
      checkBundledDemoConfigFile(args[0] || DEFAULT_PATH);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

module.exports = {
  DEFAULT_PATH,
  RESERVED_DEMO_PHONES,
  isReservedDemoPhone,
  findDemoRouting,
  assertNoBundledDemoConfig,
  checkBundledDemoConfigFile,
};
