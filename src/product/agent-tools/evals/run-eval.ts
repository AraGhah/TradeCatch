import type { EvalSuite, EvalSuiteResult } from "./types";

export async function runEvalSuite<Input, Output>(
  suite: EvalSuite<Input, Output>,
): Promise<EvalSuiteResult> {
  const results: EvalSuiteResult["results"] = [];
  for (const testCase of suite.cases) {
    try {
      const output = await suite.run(testCase.input);
      const { pass, reason } = testCase.expect(output);
      results.push({ id: testCase.id, description: testCase.description, pass, reason });
    } catch (error) {
      results.push({
        id: testCase.id,
        description: testCase.description,
        pass: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    name: suite.name,
    results,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
  };
}

export function formatEvalSuiteResult(result: EvalSuiteResult): string {
  const lines = [`${result.name}: ${result.passed}/${result.results.length} passed`];
  for (const r of result.results) {
    if (r.pass) continue;
    lines.push(`  FAIL ${r.id} — ${r.description}${r.reason ? `: ${r.reason}` : ""}${r.error ? ` (error: ${r.error})` : ""}`);
  }
  return lines.join("\n");
}
