"use strict";

const { execFileSync } = require("node:child_process");

const REPOSITORY = "AraGhah/TradeCatch";
const REQUIRED_JOBS = ["quality", "e2e"];

/** Select the newest run, including pending or failed reruns. Never reuse an older green run. */
function requireSuccessfulRun(runs, jobs, { sha, branch }) {
  const run = runs
    .filter(
      (row) =>
        row.head_sha === sha &&
        row.head_branch === branch &&
        row.path === ".github/workflows/ci.yml" &&
        ["push", "workflow_dispatch"].includes(row.event),
    )
    .sort(
      (a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt,
    )[0];
  if (!run || run.status !== "completed" || run.conclusion !== "success") {
    throw new Error(
      "The latest CI run for this revision must finish successfully before release.",
    );
  }
  for (const name of REQUIRED_JOBS) {
    const matches = jobs.filter((job) => job.name === name);
    if (
      matches.length !== 1 ||
      matches[0].status !== "completed" ||
      matches[0].conclusion !== "success"
    ) {
      throw new Error("Required CI job did not pass: " + name);
    }
  }
  return run;
}

function command(file, args) {
  return execFileSync(file, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function check({ staging = false } = {}) {
  if (command("git", ["status", "--porcelain"])) {
    throw new Error(
      "Commit the working tree before release; CI must test the deployed revision.",
    );
  }
  const sha = command("git", ["rev-parse", "HEAD"]);
  const branch = staging
    ? command("git", ["branch", "--show-current"])
    : "main";
  if (!branch)
    throw new Error("Staging releases require a named development branch.");
  const remote = command("git", [
    "ls-remote",
    "https://github.com/" + REPOSITORY + ".git",
    "refs/heads/" + branch,
  ]);
  if (remote.split(/\s/)[0] !== sha) {
    throw new Error(
      "Release revision must match the current remote " + branch + " branch.",
    );
  }
  const endpoint =
    "repos/" +
    REPOSITORY +
    "/actions/workflows/ci.yml/runs?head_sha=" +
    sha +
    "&per_page=100";
  const runs = JSON.parse(command("gh", ["api", endpoint])).workflow_runs;
  // Check the run before querying its jobs, so missing/failed runs fail closed.
  const candidates = runs
    .filter(
      (run) =>
        run.head_branch === branch &&
        ["push", "workflow_dispatch"].includes(run.event),
    )
    .sort(
      (a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt,
    );
  if (!candidates[0])
    throw new Error("No CI run exists for this revision and branch.");
  const jobs = JSON.parse(
    command("gh", [
      "api",
      "repos/" +
        REPOSITORY +
        "/actions/runs/" +
        candidates[0].id +
        "/jobs?per_page=100",
    ]),
  ).jobs;
  const run = requireSuccessfulRun(runs, jobs, { sha, branch });
  console.log("Release gate passed: " + sha + " — " + run.html_url);
  return run;
}

if (require.main === module) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== "--staging"))
      throw new Error("Usage: node scripts/require-green-ci.js [--staging]");
    check({ staging: process.argv.includes("--staging") });
  } catch (error) {
    console.error("Release blocked: " + error.message);
    console.error(
      "Push this revision and wait for both CI jobs. GitHub CLI authentication is required.",
    );
    process.exitCode = 1;
  }
}

module.exports = { check, requireSuccessfulRun };
