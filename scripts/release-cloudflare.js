"use strict";
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { check } = require("./require-green-ci");
const {
  checkWorkerDatabase,
  parseNameList,
} = require("./check-worker-database");
const { stripBundledEnvFile } = require("./strip-bundled-env-secrets");
const { checkBundledDemoConfigFile } = require("./check-bundled-demo-config");

const args = process.argv.slice(2);
const mode = args.shift();
const staging = args[0] === "--staging";
if (
  !["deploy", "upload"].includes(mode) ||
  args.some((arg) => arg !== "--staging")
)
  throw new Error(
    "Usage: node scripts/release-cloudflare.js deploy|upload [--staging]",
  );
const cli = path.resolve(
  "node_modules/@opennextjs/cloudflare/dist/cli/index.js",
);
const run = (file, values) =>
  execFileSync(process.execPath, [file, ...values], { stdio: "inherit" });
const approved = check({ staging });
checkWorkerDatabase({ staging });
run(path.resolve("scripts/clear-open-next.js"), []);
run(cli, ["build"]);
// OpenNext embeds `.env*` into next-env.mjs as runtime fallbacks. Strip secrets
// before upload so a missing Worker binding cannot revive a stale local password.
const { removedKeys } = stripBundledEnvFile();
// Those fallbacks are also how demo call routing (client_demo, 555 numbers)
// reached production on 2026-10-25. Staging runs on demo fixtures by design.
if (!staging) checkBundledDemoConfigFile();
const final = check({ staging });
if (approved.head_sha !== final.head_sha)
  throw new Error(
    "Revision changed during the build; rebuild the tested revision.",
  );
// Anything the strip removed must already be an encrypted Worker secret, or
// the release would silently take a credential away from production.
checkWorkerDatabase({
  staging,
  strippedSecrets: removedKeys,
  allowUnbound: parseNameList(process.env.RELEASE_ALLOW_UNBOUND_SECRETS),
});
// OpenNext's deploy command constructs a local platform proxy before deploying.
// That proxy cannot load same-Worker Durable Objects and emits misleading
// warnings. This project uses dummy caches, so deploy the built custom Worker
// directly; fail closed if a future cache configuration needs population.
import("./release-worker-artifact.mjs")
  .then(({ releaseArgs, assertNoCachePopulation }) =>
    assertNoCachePopulation().then(() =>
      run(
        path.resolve("node_modules/wrangler/bin/wrangler.js"),
        releaseArgs({ mode, staging, sha: final.head_sha, runId: final.id }),
      ),
    ),
  )
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
