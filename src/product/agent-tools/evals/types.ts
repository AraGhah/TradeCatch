/**
 * Minimal eval harness for scripted-conversation testing of customer-facing
 * agents (caller classifier, SMS qualifier, ...). Rerun on every prompt/rubric
 * change — see `scripts/run-agent-evals.ts`.
 */

export type EvalCase<Input, Output> = {
  id: string;
  description: string;
  input: Input;
  expect: (output: Output) => { pass: boolean; reason?: string };
};

export type EvalSuite<Input, Output> = {
  name: string;
  cases: EvalCase<Input, Output>[];
  run: (input: Input) => Output | Promise<Output>;
};

export type EvalCaseResult = {
  id: string;
  description: string;
  pass: boolean;
  reason?: string;
  error?: string;
};

export type EvalSuiteResult = {
  name: string;
  results: EvalCaseResult[];
  passed: number;
  failed: number;
};
