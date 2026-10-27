#!/usr/bin/env node
/**
 * Runs every registered agent eval suite and exits non-zero on any failure.
 * Rerun this on every prompt/rubric change for a customer-facing agent —
 * see docs on the shared agent foundation in src/product/agent-tools.
 *
 *   npx tsx scripts/run-agent-evals.ts
 */
import { callerClassifierEvalSuite } from "../src/product/agent-tools/evals/caller-classifier.evals";
import {
  formatEvalSuiteResult,
  runEvalSuite,
} from "../src/product/agent-tools/evals/run-eval";
import { smsQualifierEvalSuite } from "../src/product/agent-tools/evals/sms-qualifier.evals";
import type { EvalSuite } from "../src/product/agent-tools/evals/types";

// Each suite's `expect` is contravariant in its Output type, so the list
// is cast once here rather than trying to widen every suite to `unknown`.
const suites = [callerClassifierEvalSuite, smsQualifierEvalSuite] as unknown as EvalSuite<
  string,
  unknown
>[];

async function main() {
  let totalFailed = 0;
  for (const suite of suites) {
    const result = await runEvalSuite(suite);
    console.log(formatEvalSuiteResult(result));
    totalFailed += result.failed;
  }
  if (totalFailed > 0) {
    console.error(`\n${totalFailed} eval case(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll agent evals passed.");
}

main();
