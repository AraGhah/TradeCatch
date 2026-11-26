"use strict";

const path = require("node:path");
const { execFileSync } = require("node:child_process");

/** OpenNext can bundle .env files as fallback values. Production database
 * authentication must instead use a Worker secret that can be rotated without
 * rebuilding. This checks metadata only, never reads or prints secret values. */
function requireDatabaseSecret(bindings) {
  const matches = Array.isArray(bindings)
    ? bindings.filter((binding) => binding?.name === "DATABASE_URL")
    : [];
  if (matches.length !== 1 || matches[0].type !== "secret_text") {
    throw new Error(
      "Release blocked: configure DATABASE_URL as an encrypted secret on the target Worker; bundled .env values are not sufficient.",
    );
  }
}

/** The generic cron routes have no route-specific credential. A notification
 * secret alone cannot authorize escalations, automations or growth jobs. */
function requireSchedulerSecret(bindings) {
  if (
    !Array.isArray(bindings) ||
    !bindings.some(
      (binding) =>
        ["MISSED_CALL_OPS_SECRET", "CRON_SECRET"].includes(binding?.name) &&
        binding.type === "secret_text",
    )
  )
    throw new Error(
      "Release blocked: configure an encrypted MISSED_CALL_OPS_SECRET or CRON_SECRET on the target Worker so every scheduled route can authenticate.",
    );
}

/**
 * The build strips credentials from OpenNext's `.env*` fallback module
 * (scripts/strip-bundled-env-secrets.js). A Worker that has been running on a
 * bundled fallback, because the credential was never set as a Worker secret,
 * would lose it silently on this release: payments, the receptionist or a
 * provider integration would stop with no error at deploy time. Every stripped
 * key must therefore exist as an encrypted secret on the target Worker, unless
 * the operator lists it in RELEASE_ALLOW_UNBOUND_SECRETS to confirm that this
 * Worker does not use it. Names only; values are never read.
 */
function requireStrippedSecretsBound(stripped, bindings, allowUnbound = []) {
  if (!Array.isArray(stripped) || stripped.length === 0) return;
  const encrypted = new Set(
    (Array.isArray(bindings) ? bindings : [])
      .filter((binding) => binding?.type === "secret_text")
      .map((binding) => binding.name),
  );
  const allowed = new Set(allowUnbound);
  const missing = [...new Set(stripped)]
    .filter((name) => !encrypted.has(name) && !allowed.has(name))
    .sort();
  if (missing.length > 0)
    throw new Error(
      `Release blocked: this build no longer carries ${missing.join(", ")} from .env files, and the target Worker has no encrypted secret with that name. ` +
        "Set each one with `wrangler secret put <NAME>` first, or list the ones this Worker does not use in RELEASE_ALLOW_UNBOUND_SECRETS (comma-separated).",
    );
}

/** `A, B,,C` -> ["A", "B", "C"]; only plausible environment variable names. */
function parseNameList(value) {
  return String(value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => /^[A-Z_][A-Z0-9_]*$/i.test(name));
}

function checkWorkerDatabase({
  staging = false,
  run = execFileSync,
  strippedSecrets = [],
  allowUnbound = [],
} = {}) {
  const worker = staging ? "tradecatch-staging" : "tradecatch";
  let bindings;
  try {
    const result = run(
      process.execPath,
      [
        path.resolve("node_modules/wrangler/bin/wrangler.js"),
        "secret",
        "list",
        "--name",
        worker,
        "--format",
        "json",
        "--env-file",
        path.resolve("scripts/wrangler-types.env"),
        ...(staging ? ["--env", "staging"] : []),
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      },
    );
    bindings = JSON.parse(result);
  } catch {
    // Do not echo CLI output: auth errors or unexpected responses may contain
    // configuration details. A missing/inaccessible Worker must fail closed.
    throw new Error(
      `Release blocked: could not verify database secret metadata for ${worker}. Check Cloudflare authentication and the target Worker.`,
    );
  }
  requireDatabaseSecret(bindings);
  requireSchedulerSecret(bindings);
  requireStrippedSecretsBound(strippedSecrets, bindings, allowUnbound);
  console.log(
    `Runtime database and scheduler secrets are configured on ${worker}.`,
  );
}

if (require.main === module) {
  if (process.argv.slice(2).some((arg) => arg !== "--staging")) {
    console.error("Usage: node scripts/check-worker-database.js [--staging]");
    process.exitCode = 1;
  } else {
    try {
      checkWorkerDatabase({ staging: process.argv.includes("--staging") });
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

module.exports = {
  requireDatabaseSecret,
  requireSchedulerSecret,
  requireStrippedSecretsBound,
  parseNameList,
  checkWorkerDatabase,
};
