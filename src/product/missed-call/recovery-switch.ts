/**
 * Operator controls for the text sent to a customer after a missed call
 * ("Sorry we missed your call..."). Pure: reads only the environment it is given.
 *
 * MISSED_CALL_RECOVERY_SMS=off
 *   Sends no customer text after a missed call, from either path (the configurable
 *   automation and the Module A opening text), and cancels the ones still queued.
 *   Technician alerts, the call log and the lead are not affected. Unset, or any
 *   other value: unchanged behaviour.
 *
 * MISSED_CALL_RECOVERY_MAX_AGE_MINUTES (default 60)
 *   A missed-call text is only useful right after the call. One that is still unsent
 *   after this long (a stalled cron, a provider outage) is dropped instead of
 *   arriving hours later.
 */

type Env = Record<string, string | undefined>;

const OFF_VALUES = new Set(["off", "0", "false", "no", "disabled", "disable"]);

export const DEFAULT_RECOVERY_MAX_AGE_MINUTES = 60;
const MAX_AGE_LIMITS = { min: 1, max: 24 * 60 };

export function missedCallRecoverySmsDisabled(env: Env = process.env): boolean {
  return OFF_VALUES.has(
    (env.MISSED_CALL_RECOVERY_SMS ?? "").trim().toLowerCase(),
  );
}

export function missedCallRecoveryMaxAgeMs(env: Env = process.env): number {
  const raw = Number((env.MISSED_CALL_RECOVERY_MAX_AGE_MINUTES ?? "").trim());
  const minutes =
    Number.isFinite(raw) &&
    raw >= MAX_AGE_LIMITS.min &&
    raw <= MAX_AGE_LIMITS.max
      ? raw
      : DEFAULT_RECOVERY_MAX_AGE_MINUTES;
  return minutes * 60_000;
}
