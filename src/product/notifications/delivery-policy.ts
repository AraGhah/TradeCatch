import type { NotificationDelivery, Priority } from "./types";

export const MAX_DELIVERY_ATTEMPTS = 3;
export const DELIVERY_RATE_LIMIT = 40;
/**
 * Extra external dispatches per window that only critical alerts may use, so a
 * burst of ordinary messages can never delay an urgent one. The organization's
 * total stays bounded at DELIVERY_RATE_LIMIT + CRITICAL_DELIVERY_RESERVE.
 */
export const CRITICAL_DELIVERY_RESERVE = 10;
export const DELIVERY_WINDOW_MS = 10 * 60_000;

/** Escalation history reflects durable provider state, never queue insertion. */
export function escalationOutcome(
  status: NotificationDelivery["status"],
): string {
  switch (status) {
    case "delivered":
      return "backup_notified";
    case "submitted":
      return "backup_submitted";
    case "failed":
    case "dead":
      return "backup_failed";
    case "canceled":
      return "backup_canceled";
    case "simulated":
      return "backup_simulated";
    default:
      return "backup_queued";
  }
}

/** The most external dispatches an organization may hold in one window when this priority reserves one. */
export function dispatchCeiling(priority?: Priority) {
  return priority === "critical"
    ? DELIVERY_RATE_LIMIT + CRITICAL_DELIVERY_RESERVE
    : DELIVERY_RATE_LIMIT;
}

export function priorityRank(priority?: Priority) {
  return priority === "critical" ? 0 : priority === "high" ? 1 : 2;
}

export function scheduleRetry(delivery: NotificationDelivery, now: Date) {
  delivery.status = "pending";
  delivery.nextAttemptAt = new Date(
    now.getTime() + (delivery.attempts <= 1 ? 60_000 : 5 * 60_000),
  ).toISOString();
}

/** Twilio callbacks may be duplicated or arrive out of order. Only the current
 * SID can advance a submitted message; a terminal success never regresses. */
export function applySmsStatus(
  delivery: NotificationDelivery,
  status: string,
  errorCode: string | undefined,
  nowIso: string,
): boolean {
  if (delivery.channel !== "sms") return false;
  if (
    (status === "delivered" || status === "read") &&
    ["submitted", "pending", "failed", "dead"].includes(delivery.status)
  ) {
    delivery.status = "delivered";
    delivery.nextAttemptAt = undefined;
    delivery.lastError = undefined;
  } else if (
    ["failed", "undelivered", "canceled"].includes(status) &&
    delivery.status === "submitted"
  ) {
    const code =
      errorCode && /^\d{3,6}$/.test(errorCode) ? errorCode : undefined;
    const temporary =
      status !== "canceled" &&
      (!code || ["30001", "30003", "30008"].includes(code));
    delivery.lastError = `twilio_${status}${code ? ":" + code : ""}`;
    if (temporary && delivery.attempts < MAX_DELIVERY_ATTEMPTS) {
      scheduleRetry(delivery, new Date(nowIso));
    } else {
      delivery.status = temporary ? "dead" : "failed";
      delivery.nextAttemptAt = undefined;
    }
  } else {
    return false;
  }
  delivery.updatedAt = nowIso;
  return true;
}
