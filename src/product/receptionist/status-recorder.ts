import {
  logReceptionistDiagnostic,
  receptionistErrorCode,
} from "./diagnostics";
import type { ReceptionistEngine } from "./engine";

/** Pauses between attempts to save a call's final status: 2 retries, then it is reported. */
export const STATUS_RETRY_DELAYS_MS: readonly number[] = [150, 600];

/**
 * Save a call's final status, retrying a failed save a bounded number of
 * times. Every attempt is safe to repeat (one record per call id, finalizing
 * is claimed once), so a retry after a half-finished attempt never duplicates
 * a call or a notification. If it still fails, the failure is logged without
 * the caller's number and opened as an incident, and the call stays
 * unfinalized so the stale-call sweep (or Twilio's next callback) completes it.
 */
export async function recordCallStatus(
  engine: Pick<ReceptionistEngine, "handleCallStatus">,
  input: Parameters<ReceptionistEngine["handleCallStatus"]>[0],
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await engine.handleCallStatus(input);
      return;
    } catch (err) {
      const delay = STATUS_RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      logReceptionistDiagnostic({
        event: "status_finalize_failed",
        step: "status",
        callSid: input.callSid,
        error: err,
      });
      try {
        const { recordFailure } = await import("@/product/reliability/hooks");
        await recordFailure({
          service: "ai_receptionist",
          operation: "call_status_record",
          errorCode: receptionistErrorCode(err),
          severity: "high",
          retryable: true,
          detail: `call ${input.callSid} status ${input.callStatus}`,
        });
      } catch {
        // Reporting must never throw out of the deferred task.
      }
      return;
    }
  }
}
