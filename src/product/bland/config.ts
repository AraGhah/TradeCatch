/**
 * The business configuration Bland's agent loads at the start of a call
 * (GET /api/bland/config).
 *
 * Every value is a plain string so Bland's JSONPath → variable mapping can use
 * it directly in a pathway (`{{normal_transfer_number}}`, `{{after_hours}}`).
 * An unavailable capability is the string "false" and an unusable number is
 * the empty string, so a pathway that ignores a flag still fails safe.
 *
 * What is NOT here, on purpose: the owner's notification channels, personal
 * contacts, the ring-first phone, any secret, and the receptionist's own
 * LiveKit tool instructions. Only what the agent needs to speak for the
 * business and to route a transfer.
 */

import { isAfterHours } from "@/product/missed-call/call-handling";
import { approvedFactsSection } from "@/product/receptionist/agent-config";
import { receptionistNameOrDefault } from "@/product/receptionist/persona";
import { formatBusinessHours } from "@/product/receptionist/system-prompt";
import type { ReceptionistConfig } from "@/product/receptionist/types";
import { blandOwnLines, getBlandRoutes } from "./routes";
import { findSmsConflicts, smsTextingAllowed } from "./sms-guard";
import type { BlandTenant } from "./tenant";
import { resolveBlandTransfers, type BlandTransferVariables } from "./transfer";

const MAX_CONTEXT_CHARS = 6_000;

const flag = (value: boolean): "true" | "false" => (value ? "true" : "false");

export type BlandConfigResponse = BlandTransferVariables & {
  business_name: string;
  receptionist_name: string;
  timezone: string;
  /** The language to start in. */
  language: "fr" | "en";
  languages: string;
  after_hours: "true" | "false";
  booking_enabled: "true" | "false";
  sms_text_enabled: "true" | "false";
  /** Approved facts, FAQs, services, area, hours and pricing wording. */
  business_context: string;
  /** Codes only, never values: set-up problems the operator should fix. */
  warnings: string[];
};

function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

export function businessContext(config: ReceptionistConfig): string {
  const lines: string[] = [];
  if (config.services?.length) lines.push(`Services offered: ${config.services.join(", ")}.`);
  if (config.serviceAreas?.length) lines.push(`Areas served: ${config.serviceAreas.join(", ")}.`);
  const hours = formatBusinessHours(config.businessHours);
  if (hours) lines.push(`Business hours: ${hours} (${config.timezone}).`);
  if (config.businessAddress) lines.push(`Business address: ${oneLine(config.businessAddress, 200)}.`);
  if (config.businessPhone) lines.push(`Business phone: ${oneLine(config.businessPhone, 40)}.`);
  lines.push(
    config.pricingInfo
      ? `Approved pricing wording (say this and nothing more; an exact price needs an estimate): "${oneLine(config.pricingInfo, 500)}"`
      : "No pricing is approved. Never state, estimate or hint at a price or discount: say it depends on the project and offer an estimate.",
  );
  if (config.personality) lines.push(`Tone: ${oneLine(config.personality, 500)}`);
  const facts = approvedFactsSection(config.businessFacts, config.faqs);
  return [...lines, "", ...facts].join("\n").trim().slice(0, MAX_CONTEXT_CHARS);
}

export function buildBlandConfig(
  tenant: BlandTenant,
  allConfigs: readonly ReceptionistConfig[],
  now: Date,
  env: Record<string, string | undefined> = process.env,
): BlandConfigResponse {
  const { config } = tenant;
  const afterHours = isAfterHours(config, now);
  const { variables, rejected } = resolveBlandTransfers({
    config,
    now,
    capabilities: tenant.capabilities,
    ownLines: blandOwnLines(env),
  });
  const warnings = rejected.map((r) => `transfer_${r.slot}_${r.reason}`);
  if (
    getBlandRoutes(env).routes.some(
      (route) => route.configId === config.id && findSmsConflicts(route, allConfigs).length > 0,
    )
  ) {
    warnings.push("bland_sms_number_conflict");
  }
  const smsAllowed = smsTextingAllowed(config, env);
  return {
    ...variables,
    business_name: config.businessName,
    receptionist_name: receptionistNameOrDefault(config.receptionistName),
    timezone: config.timezone,
    language: config.languages.includes(config.defaultLanguage)
      ? config.defaultLanguage
      : (config.languages[0] ?? "fr"),
    languages: config.languages.join(","),
    after_hours: flag(afterHours),
    booking_enabled: flag(config.phoneBooking === true),
    sms_text_enabled: flag(smsAllowed),
    business_context: businessContext(config),
    warnings,
  };
}
