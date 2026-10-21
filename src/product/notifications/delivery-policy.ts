import type { NotificationDelivery, Priority } from "./types";

export const MAX_DELIVERY_ATTEMPTS = 3;
export const DELIVERY_RATE_LIMIT = 40;
export const DELIVERY_WINDOW_MS = 10 * 60_000;

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
    (delivery.status === "submitted" || delivery.status === "pending")
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
