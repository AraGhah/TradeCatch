/**
 * When a live human bridge is allowed, and how long it may ring.
 *
 * Plan limits and missing numbers are already applied on the config
 * (`fallbackTransferE164` / `routing`). This module only answers "may we dial
 * right now?" and "for how many seconds?".
 */

import type { ReceptionistConfig } from "./types";

export type TransferHoursMode = "always" | "business_hours";

/** At least one dialable person/department is configured for this call. */
export function hasLiveTransferTarget(config: ReceptionistConfig): boolean {
  return Boolean(config.fallbackTransferE164) || config.routing.length > 0;
}

export function transferHoursMode(
  config: ReceptionistConfig,
): TransferHoursMode {
  return config.transferHours === "always" ? "always" : "business_hours";
}

/**
 * True when a normal (non-emergency) transfer may start on this turn.
 * Emergencies use `emergencyTransferE164` and their own path.
 */
export function liveTransfersAllowedNow(
  config: ReceptionistConfig,
  afterHours: boolean,
): boolean {
  if (!hasLiveTransferTarget(config)) return false;
  if (transferHoursMode(config) === "always") return true;
  return !afterHours;
}

/** Ring timeout for an explicit transfer (`<Dial>`), clamped to Twilio-safe bounds. */
export function transferRingTimeoutSeconds(
  config: ReceptionistConfig,
): number {
  const raw = config.transferTimeoutSeconds ?? 30;
  return Math.min(120, Math.max(10, Math.trunc(raw)));
}
