import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const { forbiddenPaths, hasTestChange, needsHumanReview } = createRequire(
  __filename,
)("../../scripts/bug-triage-guardrails.js") as {
  forbiddenPaths: (files: string[]) => string[];
  hasTestChange: (files: string[]) => boolean;
  needsHumanReview: (
    totalLines: number,
    fileCount: number,
    maxLines?: number,
    maxFiles?: number,
  ) => boolean;
};

describe("bug-triage guardrails", () => {
  it("flags workflow files as requiring human approval", () => {
    const found = forbiddenPaths([
      "src/lib/foo.ts",
      ".github/workflows/bug-triage.yml",
    ]);
    assert.deepEqual(found, [".github/workflows/bug-triage.yml"]);
  });

  it("flags migration and schema files as requiring human approval", () => {
    const found = forbiddenPaths([
      "src/product/missed-call/migrations/002_x.sql",
      "src/product/missed-call/schema.sql",
      "scripts/sql/lockdown-data-api.sql",
    ]);
    assert.equal(found.length, 3);
  });

  it("flags dependency manifest edits as requiring human approval", () => {
    assert.deepEqual(forbiddenPaths(["package.json"]), ["package.json"]);
    assert.deepEqual(forbiddenPaths(["package-lock.json"]), [
      "package-lock.json",
    ]);
  });

  it("allows ordinary source files", () => {
    assert.deepEqual(
      forbiddenPaths(["src/lib/foo.ts", "src/product/crm/service.ts"]),
      [],
    );
  });

  it("requires a test file to be touched", () => {
    assert.equal(hasTestChange(["src/lib/foo.ts"]), false);
    assert.equal(hasTestChange(["tests/unit/foo.test.ts"]), true);
    assert.equal(hasTestChange(["src/lib/foo.test.ts"]), true);
  });

  it("flags large diffs for human review", () => {
    assert.equal(needsHumanReview(50, 3), false);
    assert.equal(needsHumanReview(200, 3), true);
    assert.equal(needsHumanReview(50, 20), true);
  });

  it("respects custom thresholds", () => {
    assert.equal(needsHumanReview(10, 1, 5, 5), true);
    assert.equal(needsHumanReview(10, 1, 20, 5), false);
  });
});
