/**
 * Typed tool layer for internal/product AI agents. Agents never touch
 * Postgres or Twilio directly — they call these functions, which wrap the
 * existing missed-call / scheduling / notifications / CRM services so every
 * guardrail already enforced there (opt-out, Canadian-number dial guard,
 * CASL consent, booking conflicts) stays enforced here too. Every call is
 * logged to `agent_runs` via `withAgentRun`.
 */

import { shouldUseDryRunSms } from "@/lib/environment";
import { isOptOut } from "@/product/missed-call/messaging";
import { createTwilioSmsPort } from "@/product/missed-call/twilio";
import type { ClientAccount } from "@/product/missed-call/types";
import { getCrmService } from "@/product/crm/runtime";
import { getNotificationService } from "@/product/notifications/runtime";
import type { NotificationType } from "@/product/notifications/types";
import { getSchedulingService } from "@/product/scheduling/runtime";
import type { BookInput } from "@/product/scheduling/service";
import { getAgentRunStore } from "./runtime";
import type { AgentToolCallLog, AgentRunStatus } from "./types";

/** Only the field `isOptOut` reads; matches the `OPT_OUT_CLIENT` pattern
 * already used in `sms-automation/service.ts` for the same purpose. */
const OPT_OUT_PROBE = { optOutKeywords: [] } as unknown as ClientAccount;

export type AgentRunContext = {
  agentName: string;
  trigger: string;
  organizationId: string | null;
  input: unknown;
};

/**
 * Runs `fn`, recording every tool call it makes (via the `log` callback
 * passed in) plus overall status/duration/cost to `agent_runs`. Agents call
 * `ctx.log` themselves after each tool invocation so partial progress is
 * captured even if a later step throws.
 */
export async function withAgentRun<T>(
  ctx: AgentRunContext,
  fn: (log: (entry: AgentToolCallLog) => void) => Promise<T>,
  costUsd = 0,
): Promise<T> {
  const toolCalls: AgentToolCallLog[] = [];
  const started = Date.now();
  let status: AgentRunStatus = "ok";
  let error: string | undefined;
  let output: T | undefined;
  try {
    output = await fn((entry) => toolCalls.push(entry));
    return output;
  } catch (err) {
    status = "error";
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await getAgentRunStore()
      .saveRun({
        agentName: ctx.agentName,
        trigger: ctx.trigger,
        organizationId: ctx.organizationId,
        input: ctx.input,
        toolCalls,
        output,
        costUsd,
        durationMs: Date.now() - started,
        status,
        error,
      })
      .catch((storeError) => {
        console.warn(
          "[agent-tools] Failed to persist agent run",
          storeError instanceof Error ? storeError.message : storeError,
        );
      });
  }
}

async function timed<T>(
  tool: string,
  input: unknown,
  run: () => Promise<T>,
): Promise<{ result: T; log: AgentToolCallLog }> {
  const started = Date.now();
  try {
    const result = await run();
    return {
      result,
      log: { tool, input, output: result, durationMs: Date.now() - started },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw Object.assign(error instanceof Error ? error : new Error(message), {
      agentToolLog: {
        tool,
        input,
        error: message,
        durationMs: Date.now() - started,
      } satisfies AgentToolCallLog,
    });
  }
}

/** Send an SMS. Refuses to send when `lastInboundBody` (the customer's most
 * recent message, if any) is a STOP/opt-out reply — mirrors the same
 * `isOptOut` check every other outbound SMS path in this repo uses. */
export async function sendSms(input: {
  to: string;
  body: string;
  lastInboundBody?: string;
}): Promise<{ sent: boolean; sid?: string; reason?: string }> {
  if (input.lastInboundBody && isOptOut(input.lastInboundBody, OPT_OUT_PROBE)) {
    return { sent: false, reason: "opted_out" };
  }
  if (shouldUseDryRunSms()) return { sent: false, reason: "dry_run" };
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  if (!from) return { sent: false, reason: "missing_from" };
  try {
    const sent = await createTwilioSmsPort().send({
      toE164: input.to,
      fromE164: from,
      body: input.body,
    });
    return { sent: true, sid: sent.sid };
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : "send_failed",
    };
  }
}

export async function getLead(organizationId: string, leadId: string) {
  return getCrmService().getLead(organizationId, leadId);
}

export async function updateLead(
  organizationId: string,
  leadId: string,
  patch: Parameters<ReturnType<typeof getCrmService>["updateLead"]>[2],
) {
  return getCrmService().updateLead(organizationId, leadId, patch);
}

export async function getBusinessHours(organizationId: string) {
  return getSchedulingService().getRules(organizationId);
}

export async function getCalendarSlots(input: {
  organizationId: string;
  serviceId?: string;
  from?: string;
  until?: string;
  serviceAddress?: string;
  technicianId?: string;
}) {
  return getSchedulingService().availability(input);
}

export async function createBooking(input: BookInput) {
  return getSchedulingService().book(input);
}

/** Best-effort owner notification. A failed notification must not undo the
 * calling agent's work — see `notifications/hooks.ts` for the same contract. */
export async function notifyOwner(input: {
  organizationId: string;
  type: NotificationType;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}) {
  try {
    await getNotificationService().enqueue({
      organizationId: input.organizationId,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload ?? {},
    });
    await getNotificationService().processDue(10);
    return { notified: true as const };
  } catch (error) {
    console.warn(
      "[agent-tools] notify_owner failed",
      error instanceof Error ? error.message : error,
    );
    return { notified: false as const };
  }
}

export { timed as timedToolCall };
