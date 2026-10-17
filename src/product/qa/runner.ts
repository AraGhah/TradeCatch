import { qaCatalog, type QaCase } from "./catalog";
import { qaId, type QaRun, type QaStatus, type QaStore } from "./store";

function clean(value: string) {
  return value.replace(/(?:sk_|whsec_|Bearer\s+)\S+/gi, "[secret]").slice(0, 300);
}

export async function executeCases(cases: QaCase[], store: QaStore, input: { suite: string; version: string; environment: string }): Promise<QaRun> {
  const started = Date.now();
  const runId = qaId("qarun");
  const results = [];
  for (const testCase of cases) {
    const caseStarted = Date.now();
    let status: QaStatus = "passed";
    let actual: string | undefined;
    let error: string | undefined;
    let records: string[] | undefined;
    if (testCase.skip) {
      status = "skipped";
      actual = testCase.skip;
    } else {
      try {
        const outcome = await testCase.run();
        if (!outcome.actual.trim()) throw new Error("The test returned no verified result.");
        actual = outcome.actual;
        records = outcome.records;
      } catch (caught) {
        status = "failed";
        error = clean(caught instanceof Error ? caught.message : "Test failed.");
      }
    }
    results.push({
      id: qaId("qares"),
      runId,
      suite: testCase.suite,
      name: testCase.name,
      status,
      expected: testCase.expected,
      actual,
      error,
      records,
      durationMs: Date.now() - caseStarted,
      createdAt: new Date().toISOString(),
    });
  }
  const run: QaRun = {
    id: runId,
    suite: input.suite,
    environment: input.environment,
    version: input.version,
    status: results.some((row) => row.status === "failed") ? "failed" : "passed",
    passed: results.filter((row) => row.status === "passed").length,
    failed: results.filter((row) => row.status === "failed").length,
    skipped: results.filter((row) => row.status === "skipped").length,
    durationMs: Date.now() - started,
    createdAt: new Date().toISOString(),
    results,
  };
  await store.saveRun(run);
  return run;
}

export async function runQaSuite(store: QaStore, suite = "all", version = "0.1.0") {
  const cases = qaCatalog().filter((testCase) => suite === "all" || testCase.suite === suite);
  return executeCases(cases, store, { suite, version, environment: process.env.TRADECATCH_ENV?.trim() || "simulation" });
}
