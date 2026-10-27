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
