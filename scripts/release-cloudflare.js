"use strict";
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { check } = require("./require-green-ci");
const { checkWorkerDatabase } = require("./check-worker-database");

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
const final = check({ staging });
if (approved.head_sha !== final.head_sha)
  throw new Error(
    "Revision changed during the build; rebuild the tested revision.",
  );
checkWorkerDatabase({ staging });
// The immutable Cloudflare version annotation binds the uploaded code to its reviewed GitHub revision.
run(cli, [
  mode,
  "--message",
  `git:${final.head_sha},ci:${final.id}`,
  ...(staging ? ["--env", "staging"] : []),
]);
