import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryQaStore } from "../../src/product/qa/store";
import { executeCases, runQaSuite } from "../../src/product/qa/runner";

describe("quality assurance", () => {
  it("passes the simulated suite and keeps live calls skipped", async () => {
    const run = await runQaSuite(createMemoryQaStore(), "all", "0.1.0");
    assert.equal(run.failed, 0, run.results.filter((row) => row.status === "failed").map((row) => `${row.name}: ${row.error}`).join("\n"));
    assert.ok(run.passed >= 8);
    assert.equal(run.skipped, 1);
    assert.equal(run.status, "passed");
  });

  it("does not mark an unverified failure as passed", async () => {
    const run = await executeCases(
      [{ id: "bad", suite: "security", name: "bad", expected: "rejected", run: async () => { throw new Error("Bearer sk_live_secret"); } }],
      createMemoryQaStore(),
      { suite: "security", version: "0.1.0", environment: "simulation" },
    );
    assert.equal(run.results[0]?.status, "failed");
    assert.equal(run.status, "failed");
    assert.equal(run.results[0]?.error?.includes("sk_live"), false);
  });
});
