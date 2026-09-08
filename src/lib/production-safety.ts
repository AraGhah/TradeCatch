export type ProductionSafetyIssue = {
  key: string;
  message: string;
};

type RuntimeEnvironment = Record<string, string | undefined>;

const UNSAFE_BOOLEAN_FLAGS = [
  {
    key: "SAAS_DEV_LOGIN",
    message: "would expose raw magic-link tokens in API responses",
  },
  {
    key: "MISSED_CALL_SANDBOX",
    message: "would expose the missed-call sandbox on a public deployment",
  },
  {
    key: "MISSED_CALL_ALLOW_DEMO",
    message: "would permit demo routing instead of verified client routing",
  },
  {
    key: "MISSED_CALL_SKIP_TWILIO_VALIDATE",
    message: "would disable Twilio webhook signature validation",
  },
  {
    key: "TRADECATCH_E2E",
    message: "is reserved for the loopback-only Playwright harness",
  },
] as const;

/** Flags that must never be enabled on a real production deployment. */
export function getProductionSafetyIssues(
  env: RuntimeEnvironment = process.env,
): ProductionSafetyIssue[] {
  const issues: ProductionSafetyIssue[] = UNSAFE_BOOLEAN_FLAGS.filter(
    ({ key }) => env[key]?.trim() === "1",
  ).map(({ key, message }) => ({ key, message }));

  if (env.MISSED_CALL_SMS_MODE?.trim().toLowerCase() === "dry-run") {
    issues.push({
      key: "MISSED_CALL_SMS_MODE",
      message: "would replace real SMS delivery with the local dry-run adapter",
    });
  }

  return issues;
}
