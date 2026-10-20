import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { requireSuccessfulRun } = require("../../scripts/require-green-ci.js");
const revision = { sha: "a".repeat(40), branch: "main" };
const run = {
  id: 1,
  head_sha: revision.sha,
  head_branch: revision.branch,
  path: ".github/workflows/ci.yml",
  event: "push",
  run_number: 1,
  run_attempt: 1,
  status: "completed",
  conclusion: "success",
};
const jobs = ["quality", "e2e"].map((name) => ({
  name,
  status: "completed",
  conclusion: "success",
}));

test("release gate accepts both completed jobs for the exact revision", () => {
  assert.equal(requireSuccessfulRun([run], jobs, revision), run);
});
test("release gate rejects missing runs, other commits, branches, workflows and PR runs", () => {
  for (const rows of [
    [],
    [{ ...run, head_sha: "b".repeat(40) }],
    [{ ...run, head_branch: "feature" }],
    [{ ...run, path: ".github/workflows/untrusted.yml" }],
    [{ ...run, event: "pull_request" }],
  ])
    assert.throws(() => requireSuccessfulRun(rows, jobs, revision));
});
test("release gate rejects failed, skipped, missing and incomplete required jobs", () => {
  for (const conclusion of [
    "failure",
    "cancelled",
    "skipped",
    "neutral",
    null,
  ]) {
    assert.throws(() =>
      requireSuccessfulRun(
        [run],
        [jobs[0], { ...jobs[1], conclusion }],
        revision,
      ),
    );
    assert.throws(() =>
      requireSuccessfulRun([{ ...run, conclusion }], jobs, revision),
    );
  }
  assert.throws(() => requireSuccessfulRun([run], [jobs[0]], revision));
  assert.throws(() =>
    requireSuccessfulRun([run], [...jobs, jobs[1]], revision),
  );
  assert.throws(() =>
    requireSuccessfulRun(
      [run],
      [jobs[0], { ...jobs[1], status: "in_progress" }],
      revision,
    ),
  );
});
test("release gate never falls back to old success after a newer failure, pending run or rerun", () => {
  for (const newer of [
    { ...run, run_number: 2, conclusion: "failure" },
    { ...run, run_number: 2, status: "in_progress", conclusion: null },
    { ...run, run_attempt: 2, conclusion: "cancelled" },
  ])
    assert.throws(() => requireSuccessfulRun([run, newer], jobs, revision));
});
test("release gate accepts a successful manual rerun", () => {
  assert.doesNotThrow(() =>
    requireSuccessfulRun(
      [{ ...run, event: "workflow_dispatch" }],
      jobs,
      revision,
    ),
  );
});
