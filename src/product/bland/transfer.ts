/**
 * The numbers a Bland pathway may transfer a live call to.
 *
 * Bland's Transfer Call node dials whatever `{{variable}}` it is given, so
 * the only protection against a wrong or hostile destination is what this
 * module puts in those variables. They come from one place: the business
 * configuration TradeCatch already validated, re-checked here at the boundary
 * (a number can enter the configuration through the owner's settings form, the
 * client roster fallback, or a founder env config, and only the first applies
 * the Canadian-number rule). Neither the caller nor the model ever supplies a
 * number.
 *
 * Every value is a string and an unusable destination is the EMPTY string, so
 * a pathway that forgets to branch on `transfer_available` fails safe: a
 * Transfer node with no number does not dial.
 */

import { isAfterHours } from "@/product/missed-call/call-handling";
import { isSafeTransferNumber } from "@/product/receptionist/profile";
import { liveTransfersAllowedNow } from "@/product/receptionist/transfer-policy";
import type { VoiceCapabilities } from "@/product/receptionist/plan-limits";
import type { ReceptionistConfig } from "@/product/receptionist/types";
import { lineKey } from "./routes";

export type TransferSlot = "normal" | "backup" | "emergency";

export type TransferRejection = {
  slot: TransferSlot;
  reason:
    | "invalid_number"
    | "premium_or_short_code"
    | "not_canadian_geographic"
    | "loops_to_own_line";
};

export type TransferUnavailableReason =
  | ""
  | "plan"
  | "not_configured"
  | "after_hours"
  | "invalid_number";

export type BlandTransferVariables = {
  normal_transfer_number: string;
  backup_transfer_number: string;
  emergency_transfer_number: string;
  transfer_available: "true" | "false";
  emergency_transfer_available: "true" | "false";
  transfer_unavailable_reason: TransferUnavailableReason;
};

const E164 = /^\+[1-9]\d{9,14}$/;
const PREMIUM_NANP = /^\+1(?:900|976)\d{7}$/;
/** N11 exchanges (211, 411, 911...): service numbers, never a person's phone. */
const N11_EXCHANGE = /^\+1\d{3}[2-9]11\d{4}$/;

function problemWith(
  config: ReceptionistConfig,
  e164: string,
  ownLines: Set<string>,
): TransferRejection["reason"] | null {
  if (!E164.test(e164)) return "invalid_number";
  if (PREMIUM_NANP.test(e164) || N11_EXCHANGE.test(e164)) return "premium_or_short_code";
  // Owner profiles must be Canadian geographic numbers (the same rule the
  // settings form applies); founder env configs may use any real E.164.
  if (config.source === "profile" && !isSafeTransferNumber(e164)) {
    return "not_canadian_geographic";
  }
  if (ownLines.has(lineKey(e164))) return "loops_to_own_line";
  return null;
}

export function resolveBlandTransfers(input: {
  config: ReceptionistConfig;
  now: Date;
  /** The organization's plan limits; unset for founder env configs. */
  capabilities?: VoiceCapabilities;
  /** Lines that must never be a destination: the Bland number(s) this call came in on. */
  ownLines: string[];
}): { variables: BlandTransferVariables; rejected: TransferRejection[] } {
  const { config } = input;
  const afterHours = isAfterHours(config, input.now);
  const ownLines = new Set(
    [config.phoneNumberE164, config.smsFromE164, ...input.ownLines]
      .filter((v): v is string => Boolean(v))
      .map(lineKey),
  );
  const rejected: TransferRejection[] = [];
  const pick = (slot: TransferSlot, value: string | undefined): string => {
    if (!value) return "";
    const problem = problemWith(config, value.trim(), ownLines);
    if (problem) {
      rejected.push({ slot, reason: problem });
      return "";
    }
    return value.trim();
  };

  const capabilities = input.capabilities;
  const planAllowsTransfer = capabilities ? capabilities.transfer : true;
  const planAllowsEmergency = capabilities ? capabilities.emergencyRouting : true;

  // Normal transfer: a person on the business's own line, in the owner's hours.
  const normalConfigured = planAllowsTransfer ? config.fallbackTransferE164 : undefined;
  const normalAllowedNow = liveTransfersAllowedNow(
    { ...config, fallbackTransferE164: normalConfigured, routing: [] },
    afterHours,
  );
  const normal = normalAllowedNow ? pick("normal", normalConfigured) : "";
  const backupRaw =
    normal && config.backupTransferE164 && config.backupTransferE164 !== normalConfigured
      ? config.backupTransferE164
      : undefined;
  const backup = pick("backup", backupRaw);

  // Emergency: the dedicated line, any hour. With none, the normal line is
  // used only when the plan includes emergency routing, so a plan that lost
  // the feature never keeps an emergency path through the back door.
  const emergencyRaw = planAllowsEmergency
    ? (config.emergencyTransferE164 ?? (planAllowsTransfer ? config.fallbackTransferE164 : undefined))
    : undefined;
  const emergency = pick("emergency", emergencyRaw);

  let reason: TransferUnavailableReason = "";
  if (!normal) {
    if (!planAllowsTransfer) reason = "plan";
    else if (!normalConfigured) reason = "not_configured";
    else if (!normalAllowedNow) reason = "after_hours";
    else reason = "invalid_number";
  }

  return {
    variables: {
      normal_transfer_number: normal,
      backup_transfer_number: backup,
      emergency_transfer_number: emergency,
      transfer_available: normal ? "true" : "false",
      emergency_transfer_available: emergency ? "true" : "false",
      transfer_unavailable_reason: reason,
    },
    rejected,
  };
}
