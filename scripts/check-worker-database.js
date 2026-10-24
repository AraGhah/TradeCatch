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

function checkWorkerDatabase({ staging = false, run = execFileSync } = {}) {
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
  console.log(`Runtime database secret is configured on ${worker}.`);
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

module.exports = { requireDatabaseSecret, checkWorkerDatabase };
