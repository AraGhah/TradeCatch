/**
 * Launch switches: capabilities that exist in the codebase but are NOT part of
 * the November 2026 launch offering.
 *
 * Each flag defaults to OFF. Turning a capability back on is a deliberate
 * operator action (set the environment variable to "1" on the server and
 * redeploy); nothing in the browser can flip one, and no plan or editable
 * business setting can override it.
 *
 * The code behind a disabled flag is preserved so the capability can return in
 * a later release. What a flag removes is the ability to RUN it: every server
 * path asks `orgHasFeature` (src/product/saas/entitlements.ts), which consults
 * this table, so a disabled capability cannot execute for any plan, legacy or
 * new, and the public site never advertises it.
 */

export type LaunchFlag =
  /** Live call transfer, emergency transfer and department routing. */
  | "callTransfer"
  /** Recording a customer's voice and answering calls in a cloned voice. */
  | "customVoice"
  /** Reactivation and contract-renewal text campaigns (bulk outreach). */
  | "bulkCampaigns"
  /** Outbound CRM integrations and webhooks. */
  | "crmIntegrations"
  /**
   * An open-ended text conversation with a customer who texts first. At launch
   * texting is for follow-ups and reminders only; inbound texts are still
   * received, stored, shown to the owner and honoured for STOP.
   */
  | "smsChatbot";

const ENV_NAME: Record<LaunchFlag, string> = {
  callTransfer: "LAUNCH_ENABLE_CALL_TRANSFER",
  customVoice: "LAUNCH_ENABLE_CUSTOM_VOICE",
  bulkCampaigns: "LAUNCH_ENABLE_BULK_CAMPAIGNS",
  crmIntegrations: "LAUNCH_ENABLE_CRM_INTEGRATIONS",
  smsChatbot: "LAUNCH_ENABLE_SMS_CHATBOT",
};

export const LAUNCH_FLAGS = Object.keys(ENV_NAME) as LaunchFlag[];

export function launchFlagEnvName(flag: LaunchFlag): string {
  return ENV_NAME[flag];
}

/** True only when the operator explicitly set the flag's variable to "1" or "true". */
export function launchFlagEnabled(
  flag: LaunchFlag,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env[ENV_NAME[flag]]?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * Scheduling is the one launch capability that is on by plan (Professional)
 * but advertised as operational only after live verification against a real
 * Google calendar. `LAUNCH_SCHEDULING_VERIFIED=1` is the operator's statement
 * that the live acceptance in docs/CALENDAR_AVAILABILITY.md has passed. It
 * changes marketing wording only; whether a given business may actually use
 * Google Calendar is still decided per business by the enrollment list
 * (GOOGLE_CALENDAR_PILOT_ORG_IDS).
 */
export function schedulingVerified(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.LAUNCH_SCHEDULING_VERIFIED?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}
