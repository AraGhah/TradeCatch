/**
 * Live demo agent (growth playbook agent #5): the sales tool for showing a
 * prospect the missed-call recovery text landing on a phone in real time —
 * the centerpiece of the LinkedIn launch video and every pilot pitch.
 *
 * This agent never places a call itself. `calls/test/route.ts` already
 * established why an auto-dialer is out of scope here: carrier cost,
 * consent, and TCPA/CRTC exposure with no safe default, so "live" mode
 * there only ever returns manual-dial instructions instead of dialing.
 * This agent follows the same rule and adds the two things a human running
 * the demo actually needs:
 *
 *   1. A hard stop if prospect consent was never captured — unlike the
 *      caller classifier's bias toward sending when unsure, there is no
 *      safe default here; a missing or incomplete `consent` always refuses.
 *   2. Automatic verification that the recovery text really went out and
 *      how fast, instead of eyeballing it — operationalizing the playbook's
 *      pre-shoot checklist ("missed call text arrives within seconds, five
 *      times in a row").
 */
import { getMissedCallReadStore } from "@/product/missed-call/runtime";
import { withAgentRun } from "../tools";

export type LiveDemoConsent = {
  prospectName: string;
  method: "verbal" | "written" | "sms" | "email";
  /** ISO timestamp consent was captured. Required — never defaulted to "now". */
  at: string;
};

export type LiveDemoPrep =
  | { ok: true; dialNumber: string; instructions: string[] }
  | { ok: false; reason: "consent_required" | "demo_client_not_found" };

function hasValidConsent(consent: LiveDemoConsent | null): boolean {
  return Boolean(
    consent &&
      consent.prospectName.trim().length > 0 &&
      consent.at.trim().length > 0 &&
      !Number.isNaN(new Date(consent.at).getTime()),
  );
}

/**
 * Step 1 — run before the demo call. Returns the number to dial and how to
 * run it, but only once consent is on record for this prospect.
 */
export async function prepareLiveDemo(input: {
  organizationId: string | null;
  demoClientId: string;
  consent: LiveDemoConsent | null;
}): Promise<LiveDemoPrep> {
  return withAgentRun(
    {
      agentName: "live-demo",
      trigger: "sales_demo_prep",
      organizationId: input.organizationId,
      input: {
        demoClientId: input.demoClientId,
        hasConsent: hasValidConsent(input.consent),
      },
    },
    async (log) => {
      const started = Date.now();

      if (!hasValidConsent(input.consent)) {
        const result: LiveDemoPrep = { ok: false, reason: "consent_required" };
        log({
          tool: "consent_gate",
          input: { hasConsent: false },
          output: result,
          durationMs: Date.now() - started,
        });
        return result;
      }

      const client = await getMissedCallReadStore().getClient(
        input.demoClientId,
      );
      if (!client) {
        const result: LiveDemoPrep = {
          ok: false,
          reason: "demo_client_not_found",
        };
        log({
          tool: "get_client",
          input: { demoClientId: input.demoClientId },
          output: result,
          durationMs: Date.now() - started,
        });
        return result;
      }

      const result: LiveDemoPrep = {
        ok: true,
        dialNumber: client.smsFromNumber,
        instructions: [
          `Call ${client.smsFromNumber} from the prospect's own phone (or hand them yours) and let it ring out — do not answer.`,
          "The recovery text arrives on that same phone within seconds.",
          `Consent on record: ${input.consent!.prospectName} via ${input.consent!.method} at ${input.consent!.at}.`,
        ],
      };
      log({
        tool: "get_client",
        input: { demoClientId: input.demoClientId },
        output: { dialNumber: result.dialNumber },
        durationMs: Date.now() - started,
      });
      return result;
    },
  );
}

export type LiveDemoVerification =
  | { ok: true; workflowId: string; smsSentAt: string; latencyMs: number }
  | { ok: false; reason: "no_recent_call" | "sms_not_sent_yet" };

/**
 * Step 2 — run right after the demo call. Confirms the opening recovery SMS
 * actually went out for that caller and how long it took: the thing a
 * presenter cannot reliably eyeball live, and exactly what the pre-shoot
 * checklist asks to verify repeatedly before filming.
 */
export async function verifyLiveDemo(input: {
  organizationId: string | null;
  demoClientId: string;
  callerE164: string;
  /** Rolling lookup window; defaults to 10 minutes. */
  withinMs?: number;
}): Promise<LiveDemoVerification> {
  return withAgentRun(
    {
      agentName: "live-demo",
      trigger: "sales_demo_verify",
      organizationId: input.organizationId,
      input,
    },
    async (log) => {
      const started = Date.now();
      const workflow = await getMissedCallReadStore().findRecentWorkflowByCaller(
        input.demoClientId,
        input.callerE164,
        input.withinMs ?? 10 * 60 * 1000,
      );
      if (!workflow) {
        const result: LiveDemoVerification = { ok: false, reason: "no_recent_call" };
        log({
          tool: "find_recent_workflow_by_caller",
          input,
          output: result,
          durationMs: Date.now() - started,
        });
        return result;
      }

