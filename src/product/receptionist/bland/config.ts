/**
 * What a Bland agent needs to answer one business's calls, built from the same
 * receptionist config the other voice paths use. Nothing here is a second
 * copy of a business rule: hours, plan limits, caller policy, approved facts
 * and the validated transfer numbers all come from the shared modules.
 *
 * The Bland conversation script (pathway or prompt) lives in Bland; this is
 * the live, per-call data it reads: the facts to answer from, which actions
 * are really available on this call, and the only numbers it may transfer to.
 */

import { isAfterHours } from "@/product/missed-call/call-handling";
import { agentCallerPolicy, approvedFactsSection } from "../agent-config";
import { receptionistNameOrDefault } from "../persona";
import type { ReceptionistConfig, ReceptionistLanguage } from "../types";
import { isBlandOwnedSmsNumber, type BlandLine } from "./lines";
import { blandTransfer, type BlandTransfer } from "./transfer";

const MAX_PROMPT_CHARS = 8_000;

export type BlandAgentConfig = {
  configId: string;
  line: {
    number: string;
    /** Who answers texts on the business's sending number. */
    smsChannel: "twilio" | "bland" | "none";
    /** The business's own sending number is also a Bland SMS number: texting is switched off. */
    smsConflict: boolean;
  };
  business: {
    name: string;
    receptionistName: string;
    address?: string;
    phone?: string;
    timezone: string;
    hours: { start: string; end: string; days: number[] };
    afterHours: boolean;
  };
  language: { default: ReceptionistLanguage; supported: ReceptionistLanguage[] };
  capabilities: {
    /** A real, connected calendar provider will confirm bookings. */
    booking: boolean;
    bookingProvider: "google" | "calcom" | "none";
    /** TradeCatch may text the caller (details or an appointment) from the business's number. */
    callerTexts: boolean;
    transfer: boolean;
    emergencyTransfer: boolean;
  };
  transfer: BlandTransfer;
  /** Greeting wording the owner set, per language. */
  greetings: { fr: string; en: string };
  /** The business's own instructions, then the facts and answers the owner approved. */
  prompt: string;
  /** Present only when this caller must not get the AI (personal contact, off switch). */
  callerPolicy?: ReturnType<typeof agentCallerPolicy>;
};

export function buildBlandConfig(
  config: ReceptionistConfig,
  input: {
    line: BlandLine;
    now: Date;
    from: string | null;
    bookingProvider: "google" | "calcom" | null;
  },
): BlandAgentConfig {
  const afterHours = isAfterHours(config, input.now);
  const transfer = blandTransfer(config, {
    lineNumber: input.line.number,
    afterHours,
  });
  const smsConflict = isBlandOwnedSmsNumber(config.smsFromE164);
  const callerTexts = Boolean(config.smsFromE164) && !smsConflict;
  const smsChannel: BlandAgentConfig["line"]["smsChannel"] = input.line.smsNumber
    ? "bland"
    : callerTexts
      ? "twilio"
      : "none";

  const callerPolicy = agentCallerPolicy(config, input.from);

  const base =
    config.systemPrompt?.trim() ||
    `You are the receptionist for ${config.businessName}, a home-services contractor. Be warm, brief and professional. Never invent prices, services or availability.`;
  const prompt = [
    base,
    "",
    ...approvedFactsSection(config.businessFacts, config.faqs),
  ]
    .join("\n")
    .slice(0, MAX_PROMPT_CHARS);

  return {
    configId: config.id,
    line: { number: input.line.number, smsChannel, smsConflict },
    business: {
      name: config.businessName,
      receptionistName: receptionistNameOrDefault(config.receptionistName),
      ...(config.businessAddress ? { address: config.businessAddress } : {}),
      ...((config.businessPhone || config.phoneNumberE164)
        ? { phone: config.businessPhone || config.phoneNumberE164 }
        : {}),
      timezone: config.timezone,
      hours: config.businessHours,
      afterHours,
    },
    language: { default: config.defaultLanguage, supported: [...config.languages] },
    capabilities: {
      booking: input.bookingProvider !== null,
      bookingProvider: input.bookingProvider ?? "none",
      callerTexts,
      transfer: transfer.normal !== null || transfer.departments.length > 0,
      emergencyTransfer: transfer.emergency !== null,
    },
    transfer,
    greetings: { fr: config.greetingFr, en: config.greetingEn },
    prompt,
    ...(callerPolicy ? { callerPolicy } : {}),
  };
}
