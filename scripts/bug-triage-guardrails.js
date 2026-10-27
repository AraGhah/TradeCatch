#!/usr/bin/env node
/**
 * Mechanical guardrails for the bug-triage-to-PR agent, enforced in CI after
 * Claude Code has made its changes on an isolated branch — independent of
 * whatever the agent's own instructions said, since instructions alone are
 * not a guardrail.
 *
 * Hard rejects (exit 1 — the workflow must not open/keep the PR open):
 *   - No new or modified file under tests/ (or *.test.ts anywhere) — a PR
 *     with no new test is rejected, per the failing-test-first rule.
 *   - Any forbidden path touched: .github/workflows, any migrations folder,
 *     any schema.sql, or package-lock.json/package.json dependency bumps —
 *     those require human approval, never an autonomous agent commit.
 *
 * Soft flag (exit 0, prints NEEDS_HUMAN_REVIEW=1 for the workflow to read):
 *   - Diff is large: more than MAX_DIFF_LINES changed lines or MAX_FILES
 *     files touched.
 *
 * Usage: node scripts/bug-triage-guardrails.js <base-ref> [head-ref]
 */
const { execFileSync } = require("child_process");
const fs = require("fs");

const MAX_DIFF_LINES = Number(process.env.BUG_TRIAGE_MAX_DIFF_LINES || 150);
const MAX_FILES = Number(process.env.BUG_TRIAGE_MAX_FILES || 8);

const FORBIDDEN_PATH_PATTERNS = [
  /^\.github\/workflows\//,
  /\/migrations\//,
  /(^|\/)schema\.sql$/,
  /^scripts\/sql\//,
  /^package(-lock)?\.json$/,
];

function sh(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function forbiddenPaths(changedFiles) {
  return changedFiles.filter((f) =>
    FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(f)),
  );
}

function hasTestChange(changedFiles) {
  return changedFiles.some(
    (f) => f.startsWith("tests/") || /\.test\.ts(x)?$/.test(f),
  );
}

function needsHumanReview(totalLines, fileCount, maxLines = MAX_DIFF_LINES, maxFiles = MAX_FILES) {
  return totalLines > maxLines || fileCount > maxFiles;
}

function main() {
  const [baseRef, headRef = "HEAD"] = process.argv.slice(2);
  if (!baseRef) {
    console.error("Usage: node scripts/bug-triage-guardrails.js <base-ref> [head-ref]");
    process.exit(2);
  }

  const changedFiles = sh(["diff", "--name-only", `${baseRef}...${headRef}`])
    .split("\n")
    .filter(Boolean);

  if (changedFiles.length === 0) {
    console.error("REJECT: no changes between base and head — nothing to review.");
    process.exit(1);
  }

  const forbidden = forbiddenPaths(changedFiles);
  if (forbidden.length > 0) {
    console.error(
      `REJECT: touches path(s) requiring human approval: ${forbidden.join(", ")}`,
    );
    process.exit(1);
  }

  if (!hasTestChange(changedFiles)) {
    console.error("REJECT: no new or modified test file — failing-test-first rule requires one.");
    process.exit(1);
  }

  const diffStat = sh(["diff", "--shortstat", `${baseRef}...${headRef}`]);
  const insertions = Number(/(\d+) insertion/.exec(diffStat)?.[1] ?? 0);
  const deletions = Number(/(\d+) deletion/.exec(diffStat)?.[1] ?? 0);
  const totalLines = insertions + deletions;

  const needsReview = needsHumanReview(totalLines, changedFiles.length);

  console.log(
    `OK: ${changedFiles.length} file(s), ${totalLines} changed line(s) (insertions=${insertions} deletions=${deletions}).`,
  );
  if (needsReview) {
    console.log(
      `NEEDS_HUMAN_REVIEW=1 (threshold: ${MAX_DIFF_LINES} lines / ${MAX_FILES} files)`,
    );
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `needs_human_review=${needsReview ? "true" : "false"}\n`,
    );
  }
}

module.exports = { forbiddenPaths, hasTestChange, needsHumanReview };

if (require.main === module) main();
