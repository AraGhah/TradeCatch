/**
 * The numbers a Bland call may transfer to, validated and named for Bland.
 *
 * Every number a business configured is checked again here, at the boundary
 * where it leaves TradeCatch, because the config can hold numbers that were
 * never run through the owner-facing validation: the fallback line falls back
 * to the technician roster, the human-review phone and the owner's phone,
 * which only had to look like E.164.
 *
 * A number is offered only if it
 *   - is E.164 (`+` and 10 to 15 digits, so no short or service codes);
 *   - for a tenant profile, passes the Canadian-geographic rule that guards
 *     against toll fraud (founder env configs may use any real E.164 number);
 *   - is not the line that was dialed, the business's own receptionist or
 *     SMS number (a transfer to ourselves would ring the agent again).
 *
 * The normal line, the backup and the departments are withheld when the owner
 * limited transfers to business hours and the office is closed; the emergency
 * line is never limited by hours. The Bland agent holds no hours logic of its
 * own, so "no number" is how it learns that a transfer is not allowed now.
 */

import { isSafeTransferNumber } from "../profile";
import { liveTransfersAllowedNow } from "../transfer-policy";
import type { ReceptionistConfig } from "../types";

const E164 = /^\+[1-9]\d{9,14}$/;
const digits = (value: string) => value.replace(/\D/g, "");

export type TransferRejection = {
  /** Which configured number: "normal", "backup", "emergency" or "department:<key>". */
  field: string;
  reason: "invalid_number" | "loops_to_line";
};

export type BlandTransfer = {
  /** "Talk to a person". Null when none is configured or transfers are closed now. */
  normal: string | null;
  /** Tried when the normal line does not answer. */
  backup: string | null;
  /** Where emergencies go (works after hours). */
  emergency: string | null;
  /** True when a normal transfer may ring on this call. */
  normalAllowedNow: boolean;
  departments: { key: string; name: string; phoneE164: string }[];
  /**
   * The same numbers in the shape of Bland's `transfer_list` (an inbound
   * number's or agent's setting): `default` is the normal line.
   */
  transferList: Record<string, string>;
  /** Numbers that were configured but are not offered, by field name only. */
  rejected: TransferRejection[];
};

export function blandTransfer(
  config: ReceptionistConfig,
  input: { lineNumber: string; afterHours: boolean },
): BlandTransfer {
  const own = new Set(
    [input.lineNumber, config.phoneNumberE164, config.smsFromE164]
      .filter((n): n is string => Boolean(n))
      .map(digits),
  );
  const rejected: TransferRejection[] = [];

  const accept = (field: string, number: string | undefined): string | null => {
    if (!number) return null;
    const trimmed = number.trim();
    const valid =
      E164.test(trimmed) &&
      (config.source !== "profile" || isSafeTransferNumber(trimmed));
    if (!valid) {
      rejected.push({ field, reason: "invalid_number" });
      return null;
    }
    if (own.has(digits(trimmed))) {
      rejected.push({ field, reason: "loops_to_line" });
      return null;
    }
    return trimmed;
  };

  const allowedNow = liveTransfersAllowedNow(config, input.afterHours);

  const general = accept("normal", config.fallbackTransferE164);
  const backupRaw =
    config.backupTransferE164 && config.backupTransferE164 !== config.fallbackTransferE164
      ? config.backupTransferE164
      : undefined;
  const backup = accept("backup", backupRaw);
  const departments = config.routing.flatMap((r) => {
    const phone = accept(`department:${r.id}`, r.phoneE164);
    return phone ? [{ key: r.id, name: r.name, phoneE164: phone }] : [];
  });
  // An emergency falls back to the normal line, as it does for the other voice agents.
  const emergency =
    accept("emergency", config.emergencyTransferE164) ?? general;

  const normal = allowedNow ? general : null;
  const offeredBackup = allowedNow && normal ? backup : null;
  const offeredDepartments = allowedNow ? departments : [];

  const transferList: Record<string, string> = {};
  if (normal) transferList.default = normal;
  if (offeredBackup) transferList.backup = offeredBackup;
  if (emergency) transferList.emergency = emergency;
  for (const d of offeredDepartments) transferList[d.key] = d.phoneE164;

  return {
    normal,
    backup: offeredBackup,
    emergency,
    normalAllowedNow: allowedNow && Boolean(normal || offeredDepartments.length > 0),
    departments: offeredDepartments,
    transferList,
    rejected,
  };
}
