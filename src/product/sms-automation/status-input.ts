import { missedCallRecoverySmsDisabled } from "@/product/missed-call/recovery-switch";
import { getAutomationServices, hasSmsSender } from "./runtime";
import { summarizeJob, type JobSummary } from "./status";

/**
 * The facts the Automations screens use to say whether a follow-up is working. Read-only:
 * it looks at the queue and at whether the business can text, and changes nothing.
 */
export async function loadStatusInputs(organizationId: string): Promise<{
  jobs: JobSummary[];
  senderReady: boolean | null;
  recoveryTextsSwitchedOff: boolean;
  nowIso: string;
}> {
  const [jobs, senderReady] = await Promise.all([
    getAutomationServices().listJobs(organizationId),
    hasSmsSender(organizationId),
  ]);
  return {
    // Summaries only: no phone number, name or message text goes to the browser.
    jobs: jobs.map(summarizeJob),
    senderReady,
    recoveryTextsSwitchedOff: missedCallRecoverySmsDisabled(),
    nowIso: new Date().toISOString(),
  };
}
