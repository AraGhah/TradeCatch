/**
 * The dashboard side of AI Call Handling: the owner-facing view, validated
 * updates, and the test call that proves a mode is really live.
 *
 * Pure functions over phone settings and call sessions, so the API route
 * stays a thin, authorized wrapper and every rule is unit-tested.
 */

import { z } from "zod";
import type { PlanId } from "@/product/saas/entitlements";
import type { CallSession } from "@/product/receptionist/types";
import {
  evaluateAiCallHandling,
  legacyAiCallMode,
  routingMethodOf,
  type AiCallHandlingState,
  type NumberRouting,
} from "./ai-call-handling";
import { aiCallHandlingFields, normalizeContactE164 } from "./phone-settings";
import type {
  AiCallMode,
  CallRoutingMethod,
  PersonalContact,
  PhoneSettings,
  RoutingTestPath,
  RoutingVerification,
} from "./types";

/** A test call must arrive within this long after "Start test call". */
export const ROUTING_TEST_WINDOW_MS = 15 * 60 * 1000;

export type AiCallHandlingView = AiCallHandlingState & {
  plan: PlanId | null;
  canEdit: boolean;
  tradecatchNumberE164: string | null;
  /** The line callers already know (forwarding source with carrier forwarding). */
  businessPhoneE164: string | null;
  contractorPhoneE164: string | null;
  ringTimeoutSeconds: number;
  /** Owner/admin only; others see the count. */
  personalContacts: PersonalContact[] | null;
  personalContactCount: number;
  personalCallPolicy: NonNullable<PhoneSettings["personalCallPolicy"]>;
  personalCallMessage: { fr: string; en: string };
  personalCallTransferE164: string | null;
  unknownCallerPolicy: NonNullable<PhoneSettings["unknownCallerPolicy"]>;
  modeUpdatedAt: string | null;
  routingTestStartedAt: string | null;
  numberRoutingCheckedAt: string | null;
  livekitHandoffReady: boolean;
};

export function buildAiCallHandlingView(input: {
  plan: PlanId | undefined;
  activated: boolean;
  tradecatchNumberE164?: string;
  phone: PhoneSettings;
  canEdit: boolean;
  livekitHandoffReady: boolean;
  transferTargets?: (string | undefined)[];
}): AiCallHandlingView {
  const { phone } = input;
  const state = evaluateAiCallHandling({
    plan: input.plan,
    activated: input.activated,
    tradecatchNumberE164: input.tradecatchNumberE164,
    phone,
    numberRouting: phone.numberRoutingCheck?.result,
    livekitHandoffReady: input.livekitHandoffReady,
    transferTargets: input.transferTargets,
  });
  const contacts = phone.personalContacts ?? [];
  return {
    ...state,
    plan: input.plan ?? null,
    canEdit: input.canEdit,
    tradecatchNumberE164: input.tradecatchNumberE164 ?? null,
    businessPhoneE164: phone.businessPhoneE164 ?? null,
    contractorPhoneE164: phone.contractorPhoneE164 ?? null,
    ringTimeoutSeconds: phone.humanRingTimeoutSeconds ?? 25,
    personalContacts: input.canEdit ? contacts : null,
    personalContactCount: contacts.length,
    personalCallPolicy: phone.personalCallPolicy ?? "message",
    personalCallMessage: {
      fr: phone.personalCallMessage?.fr ?? "",
      en: phone.personalCallMessage?.en ?? "",
    },
    personalCallTransferE164: phone.personalCallTransferE164 ?? null,
    unknownCallerPolicy: phone.unknownCallerPolicy ?? "ai",
    modeUpdatedAt: phone.modeUpdatedAt ?? null,
    routingTestStartedAt: phone.routingTestStartedAt ?? null,
    numberRoutingCheckedAt: phone.numberRoutingCheck?.checkedAt ?? null,
    livekitHandoffReady: input.livekitHandoffReady,
  };
}

/** Phone numbers as typed ("514 555-0142") become E.164 before validation. */
const typedPhone = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (v) =>
      typeof v === "string" && v.trim() ? (normalizeContactE164(v) ?? v) : v,
    schema,
  );

/** What the dashboard may send. Contacts arrive as typed and are normalized. */
export const aiCallHandlingUpdateSchema = z
  .object({
    aiCallMode: z.enum(["missed_calls_only", "ai_answers_all"]),
    routingMethod: z.enum(["tradecatch_number", "carrier_forwarding"]),
    contractorPhoneE164: typedPhone(aiCallHandlingFields.contractorPhoneE164),
    businessPhoneE164: z
      .union([z.literal(""), z.string().trim().max(32)])
      .optional(),
    ringTimeoutSeconds: z.number().int().min(10).max(40).optional(),
    personalContacts: z
      .array(
        z.object({
          e164: z.string().trim().max(32),
          label: z.string().trim().max(60).optional(),
        }),
      )
      .max(50)
      .optional(),
    personalCallPolicy: z.enum(["message", "transfer", "end"]).optional(),
    personalCallMessage: aiCallHandlingFields.personalCallMessage,
    personalCallTransferE164: typedPhone(
      aiCallHandlingFields.personalCallTransferE164,
    ),
    unknownCallerPolicy: z.enum(["ai", "message"]).optional(),
  })
  .strict();

export type AiCallHandlingUpdate = z.infer<typeof aiCallHandlingUpdateSchema>;

export type UpdateIssue = { field: string; code: string };

/**
 * Merge an owner's update into the saved phone settings. Changing the mode,
 * the routing method or the ring-first phone resets verification: the next
 * test call must prove the new setup.
 */
export function applyAiCallHandlingUpdate(input: {
  previous: PhoneSettings;
  update: AiCallHandlingUpdate;
  tradecatchNumberE164?: string;
  now: Date;
}):
  | { ok: true; phone: PhoneSettings; routingChanged: boolean }
  | { ok: false; issues: UpdateIssue[] } {
  const { previous, update } = input;
  const issues: UpdateIssue[] = [];

  const contacts: PersonalContact[] = [];
  const seen = new Set<string>();
  (update.personalContacts ?? previous.personalContacts ?? []).forEach((c, i) => {
    const e164 = normalizeContactE164(c.e164);
    if (!e164) {
      issues.push({ field: `personalContacts.${i}.e164`, code: "invalid_phone" });
      return;
    }
    if (seen.has(e164)) return;
    seen.add(e164);
    contacts.push(c.label?.trim() ? { e164, label: c.label.trim() } : { e164 });
  });

  let businessPhone = previous.businessPhoneE164;
  if (update.businessPhoneE164 !== undefined) {
    if (update.businessPhoneE164 === "") businessPhone = undefined;
    else {
      const e164 = normalizeContactE164(update.businessPhoneE164);
      if (!e164) issues.push({ field: "businessPhoneE164", code: "invalid_phone" });
      else businessPhone = e164;
    }
  }

  const own = input.tradecatchNumberE164;
  const method = update.routingMethod;
  const contractor = update.contractorPhoneE164;
  if (contractor && own && contractor === own) {
    issues.push({ field: "contractorPhoneE164", code: "loop_tradecatch_number" });
  }
  if (method === "carrier_forwarding") {
    if (!businessPhone) {
      issues.push({ field: "businessPhoneE164", code: "required_for_forwarding" });
    } else if (own && businessPhone === own) {
      issues.push({ field: "businessPhoneE164", code: "loop_tradecatch_number" });
    }
  }
  if (method === "tradecatch_number" && update.aiCallMode === "missed_calls_only") {
    if (!contractor) {
      issues.push({ field: "contractorPhoneE164", code: "required_for_missed_calls" });
    }
  }

  const policy = update.personalCallPolicy ?? previous.personalCallPolicy ?? "message";
  const transfer = update.personalCallTransferE164;
  if (policy === "transfer") {
    if (!transfer) {
      issues.push({ field: "personalCallTransferE164", code: "required_for_transfer" });
    } else if (transfer === own) {
      issues.push({ field: "personalCallTransferE164", code: "loop_tradecatch_number" });
    } else if (method === "carrier_forwarding" && transfer === businessPhone) {
      // That phone forwards here when unanswered: the call would loop.
      issues.push({ field: "personalCallTransferE164", code: "loop_forwarding_phone" });
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  const previousMode = previous.aiCallMode ?? legacyAiCallMode(previous);
  const routingChanged =
    !previous.aiCallMode ||
    previousMode !== update.aiCallMode ||
    routingMethodOf(previous) !== method ||
    (previous.contractorPhoneE164 ?? undefined) !== (contractor ?? undefined) ||
    (method === "carrier_forwarding" && previous.businessPhoneE164 !== businessPhone);

  const phone: PhoneSettings = {
    ...previous,
    aiCallMode: update.aiCallMode,
    routingMethod: method,
    contractorPhoneE164: contractor,
    businessPhoneE164: businessPhone,
    // Keep the older strategy field in step with the mode, so every reader
    // of the settings (and the advanced form) agrees with it.
    inboundStrategy:
      update.aiCallMode === "missed_calls_only" && method === "tradecatch_number"
        ? "human_first"
        : "ai_first",
    humanRingTimeoutSeconds: update.ringTimeoutSeconds ?? previous.humanRingTimeoutSeconds,
    personalContacts: contacts,
    personalCallPolicy: policy,
    personalCallMessage: update.personalCallMessage ?? previous.personalCallMessage,
    personalCallTransferE164: policy === "transfer" ? transfer : undefined,
    unknownCallerPolicy: update.unknownCallerPolicy ?? previous.unknownCallerPolicy ?? "ai",
    modeUpdatedAt: routingChanged ? input.now.toISOString() : previous.modeUpdatedAt,
    routingTestStartedAt: routingChanged ? undefined : previous.routingTestStartedAt,
  };
  return { ok: true, phone, routingChanged };
}

/** Which way a recorded call went, for the test-call check. */
export function routingPathOf(
  session: CallSession,
  method: CallRoutingMethod,
): RoutingTestPath {
  if (method === "carrier_forwarding" && session.routing?.forwardedFrom) {
    return "forwarded_by_carrier";
  }
  if (session.callSid.startsWith("lk_")) return "ai_answered_livekit_direct";
  if (
    session.transfers.some(
      (t) => t.reason === "human_first" || t.reason === "overflow_ring",
    )
  ) {
    return "rang_contractor_first";
  }
  return method === "carrier_forwarding" ? "forwarded_by_carrier" : "ai_answered_webhook";
}

function expectedPaths(mode: AiCallMode, method: CallRoutingMethod): RoutingTestPath[] {
  if (method === "carrier_forwarding") {
    // TradeCatch only sees that the call arrived, not the carrier's reason.
    return ["forwarded_by_carrier", "ai_answered_livekit_direct"];
  }
  return mode === "missed_calls_only"
    ? ["rang_contractor_first"]
    : ["ai_answered_webhook", "ai_answered_livekit_direct"];
}

export type TestCallResult =
  | { status: "not_started" }
  | { status: "expired" }
  | { status: "waiting" }
  | { status: "verified"; verification: RoutingVerification }
  | { status: "other_path"; path: RoutingTestPath };

/**
 * Look for the owner's test call among this business's recent calls. Only
 * calls that started after "Start test call" (and inside the window) count;
 * personal-contact calls never do.
 */
export function observeTestCall(input: {
  phone: PhoneSettings;
  mode: AiCallMode;
  sessions: CallSession[];
  now: Date;
}): TestCallResult {
  const started = input.phone.routingTestStartedAt;
  if (!started) return { status: "not_started" };
  const startMs = Date.parse(started);
  const method = routingMethodOf(input.phone);
  const candidates = input.sessions
    .filter((s) => {
      const at = Date.parse(s.startedAt);
      return (
        at >= startMs &&
        at <= startMs + ROUTING_TEST_WINDOW_MS &&
        !s.routing?.callerPolicy
      );
    })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (candidates.length === 0) {
    return input.now.getTime() > startMs + ROUTING_TEST_WINDOW_MS
      ? { status: "expired" }
      : { status: "waiting" };
  }
  const expected = expectedPaths(input.mode, method);
  // A LiveKit-handled webhook call leaves a webhook record and an agent
  // report; any expected path among the test window's calls proves it.
  for (const s of candidates) {
    const path = routingPathOf(s, method);
    if (expected.includes(path)) {
      return {
        status: "verified",
        verification: {
          mode: input.mode,
          method,
          path,
          verifiedAt: input.now.toISOString(),
        },
      };
    }
  }
  return { status: "other_path", path: routingPathOf(candidates[0]!, method) };
}

export type { NumberRouting };
