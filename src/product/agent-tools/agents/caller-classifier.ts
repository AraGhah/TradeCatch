/**
 * Caller classifier agent. Sorts a missed call into real lead, existing
 * customer, spam, or wrong number BEFORE any recovery SMS goes out — reusing
 * the existing eligibility gate (`isEligibleRecoveryCaller`) and CRM lookup
 * rather than inventing new spam/number heuristics.
 *
 * Rule from the build plan: default to sending the basic recovery text
 * whenever the classifier is unsure. Only the two states this function is
 * confident about — a caller the eligibility gate already rejects — turn
 * `sendBasicText` off. A missing or failed CRM lookup still defaults to
 * `real_lead` + `sendBasicText: true`, never to suppressing the text.
 */
import { isEligibleRecoveryCaller } from "@/product/missed-call/call-handling";
import { getCrmService } from "@/product/crm/runtime";
import { withAgentRun } from "../tools";

export type CallerCategory =
  | "real_lead"
  | "existing_customer"
  | "spam"
  | "wrong_number";

export type CallerClassification = {
  category: CallerCategory;
  confidence: "high" | "low";
  reason: string;
  /** Whether the standard missed-call recovery SMS should still be sent. */
  sendBasicText: boolean;
};

const SPAM_REASONS = new Set([
  "anonymous_caller",
  "caller_is_own_line",
  "toll_free_caller",
]);

export async function classifyCaller(input: {
  /** Null when the caller is on single-tenant Module A with no SaaS
   * organization linked yet — CRM lookup is skipped, not treated as spam. */
  organizationId: string | null;
  callerE164: string;
  smsFromE164?: string;
}): Promise<CallerClassification> {
  return withAgentRun(
    {
      agentName: "caller-classifier",
      trigger: "missed_call",
      organizationId: input.organizationId,
      input,
    },
    async (log) => {
      const started = Date.now();
      const eligibility = isEligibleRecoveryCaller({
        callerE164: input.callerE164,
        smsFromE164: input.smsFromE164,
      });
      if (!eligibility.ok) {
        const result: CallerClassification = {
          category: SPAM_REASONS.has(eligibility.reason)
            ? "spam"
            : "wrong_number",
          confidence: "high",
          reason: eligibility.reason,
          sendBasicText: false,
        };
        log({
          tool: "is_eligible_recovery_caller",
          input,
          output: result,
          durationMs: Date.now() - started,
        });
        return result;
      }

      if (input.organizationId) {
        try {
          const customer = await getCrmService().findCustomerByPhone(
            input.organizationId,
            input.callerE164,
          );
          if (customer) {
            const result: CallerClassification = {
              category: "existing_customer",
              confidence: "high",
              reason: "matched_crm_customer",
              sendBasicText: true,
            };
            log({
              tool: "find_customer_by_phone",
              input,
              output: result,
              durationMs: Date.now() - started,
            });
            return result;
          }
        } catch {
          // Unsure — fall through to the safe default below rather than
          // ever letting a lookup failure block the recovery text.
        }
      }

      const result: CallerClassification = {
        category: "real_lead",
        confidence: input.organizationId ? "high" : "low",
        reason: input.organizationId
          ? "no_crm_match"
          : "no_organization_context",
        sendBasicText: true,
      };
      log({
        tool: "classify_default",
        input,
        output: result,
        durationMs: Date.now() - started,
      });
      return result;
    },
  );
}
