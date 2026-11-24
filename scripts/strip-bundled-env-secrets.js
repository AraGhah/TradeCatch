"use strict";

/**
 * OpenNext compiles `.env*` into `.open-next/cloudflare/next-env.mjs` and the
 * Worker init applies those values with `process.env[key] ??= bundled` when a
 * Cloudflare binding is missing. That is how a stale local DATABASE_URL caused
 * production PostgreSQL `28P01` (invalid password) when the Worker secret was
 * absent. Strip secret keys from that module after every Cloudflare build so
 * authentication can only come from encrypted Worker secrets.
 *
 * Never prints secret values. Usage:
 *   node scripts/strip-bundled-env-secrets.js [.open-next/cloudflare/next-env.mjs]
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_PATH = path.join(".open-next", "cloudflare", "next-env.mjs");

/** Key names that must never ship as OpenNext fallbacks. */
const SECRET_KEY =
  /^(?:DATABASE_URL|AUTH_SECRET|INSTALLATION_CREDENTIAL|.*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|CREDENTIAL).*)$/i;

/** Same shape as scripts/check-secrets.js — catch a password put under a weird key. */
const DATABASE_URL_WITH_PASSWORD =
  /postgres(?:ql)?:\/\/[^:/\s'"@]+:(?!password|pass|user|\$|<|\[|\{|%s|\*)[^@\s'"]{6,}@(?!localhost|127\.0\.0\.1|host\b)/;

const EXPORT_LINE =
  /^export const (production|development|test) = (\{[\s\S]*?\});$/gm;

function isSecretKey(name) {
  if (typeof name !== "string" || name.startsWith("NEXT_PUBLIC_")) return false;
  return SECRET_KEY.test(name);
}

/**
 * Remove secret keys from one compiled env object. Returns the cleaned object
 * and how many keys were dropped.
 */
function stripSecretKeys(env) {
  if (!env || typeof env !== "object" || Array.isArray(env))
    throw new Error("Bundled env mode must be a plain object.");
  const cleaned = {};
  let removed = 0;
  for (const [key, value] of Object.entries(env)) {
    if (isSecretKey(key)) {
      removed += 1;
      continue;
    }
    cleaned[key] = value;
  }
  return { cleaned, removed };
}

/**
 * Rewrite next-env.mjs so no secret keys remain as fallbacks.
 * Throws if a database URL with a password is still present after stripping.
 */
function stripBundledEnvSecrets(source) {
  if (typeof source !== "string")
    throw new Error("Bundled env module source must be a string.");
  let removed = 0;
  let modes = 0;
  const rewritten = source.replace(EXPORT_LINE, (_match, mode, json) => {
    modes += 1;
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error(
        `Release blocked: could not parse bundled env for mode "${mode}".`,
      );
    }
    const { cleaned, removed: count } = stripSecretKeys(parsed);
    removed += count;
    return `export const ${mode} = ${JSON.stringify(cleaned)};`;
  });
  if (modes !== 3)
    throw new Error(
      "Release blocked: expected production, development and test exports in next-env.mjs.",
    );
  if (DATABASE_URL_WITH_PASSWORD.test(rewritten))
    throw new Error(
      "Release blocked: a database URL with a password remains in the OpenNext env fallback after stripping secrets.",
    );
  return { source: rewritten.endsWith("\n") ? rewritten : `${rewritten}\n`, removed };
}

function stripBundledEnvFile(
  filePath = DEFAULT_PATH,
  { readFile = fs.readFileSync, writeFile = fs.writeFileSync } = {},
) {
  const resolved = path.resolve(filePath);
  let original;
  try {
    original = readFile(resolved, "utf8");
  } catch {
    throw new Error(
      `Release blocked: missing OpenNext env module at ${filePath}. Run the Cloudflare build first.`,
    );
  }
  const { source, removed } = stripBundledEnvSecrets(original);
  if (source !== original) writeFile(resolved, source, "utf8");
  if (removed > 0)
    console.log(
      `Removed ${removed} secret key(s) from OpenNext env fallback (${filePath}). Use Worker secrets for DATABASE_URL and credentials.`,
    );
  else console.log(`OpenNext env fallback has no secret keys (${filePath}).`);
  return { removed, path: resolved };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length > 1) {
    console.error(
      "Usage: node scripts/strip-bundled-env-secrets.js [path/to/next-env.mjs]",
    );
    process.exitCode = 1;
  } else {
    try {
      stripBundledEnvFile(args[0] || DEFAULT_PATH);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

module.exports = {
  SECRET_KEY,
  isSecretKey,
  stripSecretKeys,
  stripBundledEnvSecrets,
  stripBundledEnvFile,
  DEFAULT_PATH,
};
