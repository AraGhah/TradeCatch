/**
 * Live phone test: what to dial, what should happen, and whether the line is
 * ready. Read-only by construction.
 *
 * This module places no call, writes nothing, and imports no carrier or voice
 * provider client. The owner dials the number from their own phone; carrier
 * charges for that call are theirs, which the dashboard says in plain words.
 * What it adds over "here is a number" is the truth about the routing:
 *
 * - the number is the one the receptionist is really configured on
 *   (`config.phoneNumberE164`, the number the webhook matches), plus any Bland
 *   line routed to this business, plus the owner's public line when callers
 *   reach TradeCatch through carrier forwarding. The business's own contact
 *   phone is never offered as a test number: it is the owner's phone.
 * - what a call will do right now comes from `resolveInboundRouting`, the same
 *   function the live webhook uses;
 * - what the receptionist will say (greeting, language, voice) comes from the
 *   same config the engine and the Bland configuration endpoint read.
 */

import { getBlandRoutes } from "@/product/bland/routes";
import { shouldAnswerCall } from "@/product/receptionist/call-handling";
import { greetingStatement } from "@/product/receptionist/prompts";
import { firstLanguage } from "@/product/receptionist/language-select";
import { receptionistNameOrDefault } from "@/product/receptionist/persona";
import type { VoiceCapabilities } from "@/product/receptionist/plan-limits";
import {
  buildProfileConfig,
  type ReceptionistProfile,
} from "@/product/receptionist/profile";
import type { ClientAccount } from "@/product/missed-call/types";
import type {
  ReceptionistConfig,
  ReceptionistLanguage,
} from "@/product/receptionist/types";
import { isAfterHours } from "@/product/missed-call/call-handling";
import { resolveInboundRouting } from "./call-routing";
import { ringFirstBlockedByPlan } from "./plan-routing";
import { parsePhoneSettings } from "./phone-settings";
import { SIMULATED_CALLER_E164 } from "./live-test";

export type LiveTestCheckCode =
  | "activated"
  | "receptionist_enabled"
  | "plan_includes_voice"
  | "number_assigned"
  | "number_reaches_this_business"
  | "number_routed_to_tradecatch"
  | "answering_now"
  | "bland_route"
  | "bland_secrets";

export type LiveTestCheck = {
  code: LiveTestCheckCode;
  status: "ok" | "warning" | "problem";
};

export type LiveTestNumber = {
  e164: string;
  /** Where a call to this number is answered. */
  via: "tradecatch" | "bland" | "carrier_forwarding";
};

export type LiveTestInstructions = {
  mode: "live_instructions";
  /** Always 0: opening this view, or pressing its button, never starts a call. */
  callsPlaced: 0;
  /** The owner dials; the carrier bills that call to the owner's phone plan. */
  carrierChargesMayApply: true;
  dialNumber: string | null;
  numbers: LiveTestNumber[];
  /** What a call arriving now does, from the saved routing. */
  routing: {
    action: "ring_human" | "ai" | "reject";
    reason: string;
    afterHours: boolean;
    /** Saved to ring the contractor first, but the plan has no live transfer. */
    limitedByPlan?: boolean;
    ringTimeoutSeconds?: number;
    ringTargetLast4?: string;
    screened?: boolean;
  } | null;
  /** What the receptionist will say and how. */
  expected: {
    businessName: string;
    receptionistName?: string;
    greeting: string;
    startLanguage: ReceptionistLanguage;
    languages: ReceptionistLanguage[];
    voice: string;
    engine: string;
  } | null;
  checks: LiveTestCheck[];
  /** True when nothing blocks a real test call. */
  ready: boolean;
};

function last4(e164: string | undefined) {
  const digits = (e164 ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

const key = (value: string) =>
  value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

export function buildLiveTestInstructions(input: {
  organizationId: string;
  profile: ReceptionistProfile;
  client: ClientAccount;
  capabilities?: VoiceCapabilities;
  /** Every receptionist config on this server, to prove the number reaches this business. */
  configs: readonly ReceptionistConfig[];
  now?: Date;
  env?: Record<string, string | undefined>;
}): LiveTestInstructions {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  const phone = parsePhoneSettings(input.profile.settings.phoneSettings);
  const checks: LiveTestCheck[] = [];
  const add = (code: LiveTestCheckCode, status: LiveTestCheck["status"]) =>
    checks.push({ code, status });

  add("activated", input.profile.activated ? "ok" : "problem");

  let config: ReceptionistConfig | null = null;
  try {
    config = buildProfileConfig(input.profile, {
      client: input.client,
      capabilities: input.capabilities,
    });
  } catch {
    config = null;
  }

  add(
    "receptionist_enabled",
    config?.enabled && config.callHandlingMode !== "disabled" ? "ok" : "problem",
  );
  add(
    "plan_includes_voice",
    !input.capabilities || input.capabilities.voice ? "ok" : "problem",
  );

  const numbers: LiveTestNumber[] = [];
  if (config?.phoneNumberE164) {
    if (phone.routingMethod === "carrier_forwarding" && phone.businessPhoneE164) {
      numbers.push({ e164: phone.businessPhoneE164, via: "carrier_forwarding" });
    }
    numbers.push({ e164: config.phoneNumberE164, via: "tradecatch" });
  }
  if (config) {
    for (const route of getBlandRoutes(env).routes) {
      if (route.configId === config.id) {
        numbers.push({ e164: route.toE164, via: "bland" });
      }
    }
  }
  add("number_assigned", numbers.length > 0 ? "ok" : "problem");

  // Every number must lead to THIS business and no other.
  if (config && numbers.length > 0) {
    const owners = (e164: string, via: LiveTestNumber["via"]) => {
      if (via === "carrier_forwarding") return [config];
      if (via === "bland") {
        return getBlandRoutes(env)
          .routes.filter((r) => key(r.toE164) === key(e164))
          .map((r) => input.configs.find((c) => c.id === r.configId))
          .filter((c): c is ReceptionistConfig => Boolean(c));
      }
      return input.configs.filter(
        (c) => c.enabled && key(c.phoneNumberE164) === key(e164),
      );
    };
    const reaches = numbers.every((n) => {
      const found = owners(n.e164, n.via);
      return found.length === 1 && found[0]!.id === config!.id;
    });
    add("number_reaches_this_business", reaches ? "ok" : "problem");
  } else {
    add("number_reaches_this_business", "problem");
  }

  const routingCheck = phone.numberRoutingCheck?.result;
  add(
    "number_routed_to_tradecatch",
    routingCheck === "webhook"
      ? "ok"
      : routingCheck === "sip_trunk" || routingCheck === "elsewhere"
        ? "problem"
        : "warning",
  );

  const answeringNow = config ? shouldAnswerCall(config, now) : false;
  add("answering_now", answeringNow ? "ok" : "problem");

  if (config && getBlandRoutes(env).routes.some((r) => r.configId === config!.id)) {
    add("bland_route", "ok");
    // Presence only: the values are secrets and are never read out.
    const toolSecret = (env.BLAND_TOOL_SECRET ?? "").trim();
    const webhookSecret = (env.BLAND_WEBHOOK_SECRET ?? "").trim();
    add(
      "bland_secrets",
      toolSecret.length >= 32 && webhookSecret.length > 0 ? "ok" : "problem",
    );
  }

  let routing: LiveTestInstructions["routing"] = null;
  let expected: LiveTestInstructions["expected"] = null;
  if (config) {
    const { routing: decision } = resolveInboundRouting({
      config,
      fromE164: SIMULATED_CALLER_E164,
      now,
    });
    routing = {
      action: decision.action,
      reason: decision.reason,
      afterHours: isAfterHours(config, now),
      ...(decision.action !== "ring_human" &&
      ringFirstBlockedByPlan({
        profile: input.profile,
        client: input.client,
        capabilities: input.capabilities,
        fromE164: SIMULATED_CALLER_E164,
        now,
      })
        ? { limitedByPlan: true }
        : {}),
      ...(decision.action === "ring_human"
        ? {
            ringTimeoutSeconds: decision.timeoutSeconds,
            ringTargetLast4: last4(decision.phoneE164),
            screened: config.callScreening === true,
          }
        : {}),
    };
    const startLanguage = firstLanguage(config.languages, config.defaultLanguage);
    expected = {
      businessName: config.businessName,
      receptionistName: receptionistNameOrDefault(config.receptionistName),
      greeting: greetingStatement(config, startLanguage),
      startLanguage,
      languages: config.languages,
      voice: config.voices[startLanguage],
      engine: config.voiceEngine ?? "gather",
    };
  }

  const primary =
    numbers.find((n) => n.via === "carrier_forwarding") ??
    numbers.find((n) => n.via === "tradecatch") ??
    numbers[0];

  return {
    mode: "live_instructions",
    callsPlaced: 0,
    carrierChargesMayApply: true,
    dialNumber: primary?.e164 ?? null,
    numbers,
    routing,
    expected,
    checks,
    ready: checks.every((c) => c.status !== "problem"),
  };
}
