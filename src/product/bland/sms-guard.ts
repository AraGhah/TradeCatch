/**
 * Keeps Bland's SMS channel and TradeCatch's Twilio SMS responder from
 * answering the same customer.
 *
 * How the two collide: a phone number has ONE inbound SMS destination. The
 * Twilio responder (/api/twilio/sms/inbound) owns every number saved as a
 * business's `smsFromNumber` (a unique index) and handles STOP, technician
 * commands, CRM capture and AI replies. Bland's SMS (bring-your-own Twilio
 * account, or its native `bland-sms` tool) takes over a number's inbound
 * configuration. Put both on one number and the last one configured wins;
 * until then customers can get two replies, or STOP and technician replies
 * land where TradeCatch cannot see them.
 *
 * The rules, all enforced in code rather than by convention:
 *   1. A number Bland texts from is declared in BLAND_ROUTES_JSON (`smsE164`).
 *   2. It must not be any business's voice line, or any receptionist's
 *      `smsFromE164`, or another route's number (routes.ts, findSmsConflicts).
 *   3. On a declared Bland number the Twilio responder never sends an AI
 *      reply or creates CRM records; STOP and technician commands are still
 *      honored (the same path as a suspended business).
 *   4. A receptionist whose own text number is Bland's gets
 *      `sms_text_enabled: false`: the agent will not promise a text that the
 *      other system would answer.
 */

import type { ReceptionistConfig } from "@/product/receptionist/types";
import { blandSmsNumbers, lineKey, type BlandRoute } from "./routes";

export type SmsConflict = {
  /** Which receptionist config holds the number the route also claims. */
  configId: string;
  reason: "is_voice_line" | "is_receptionist_sms_number";
};

/** True when `numberE164` is a number Bland texts from, so Twilio's responder must stay out of its way. */
export function isBlandSmsNumber(
  numberE164: string | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const key = lineKey(numberE164);
  if (key.length < 10) return false;
  return blandSmsNumbers(env).some((n) => lineKey(n) === key);
}

/** Every receptionist that also uses the number this route says Bland texts from. */
export function findSmsConflicts(
  route: BlandRoute,
  configs: readonly ReceptionistConfig[],
): SmsConflict[] {
  if (!route.smsE164) return [];
  const key = lineKey(route.smsE164);
  const out: SmsConflict[] = [];
  for (const config of configs) {
    if (lineKey(config.phoneNumberE164) === key) {
      out.push({ configId: config.id, reason: "is_voice_line" });
    }
    if (config.smsFromE164 && lineKey(config.smsFromE164) === key) {
      out.push({ configId: config.id, reason: "is_receptionist_sms_number" });
    }
  }
  return out;
}

/**
 * May the agent offer to text the caller? Only from the business's own SMS
 * number, and never from one Bland also texts from.
 */
export function smsTextingAllowed(
  config: ReceptionistConfig,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(config.smsFromE164) && !isBlandSmsNumber(config.smsFromE164, env);
}
