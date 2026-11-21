import { safeDatabaseErrorCode } from "@/lib/postgres-pool";
import { getReliabilityService } from "./runtime";

export type FailureInput = {
  organizationId?: string;
  service: string;
  operation: string;
  errorCode: string;
  severity?: "low" | "medium" | "high" | "critical";
  retryable?: boolean;
  detail?: string;
  simulated?: boolean;
};

type FailureRecord = FailureInput & {
  severity: "low" | "medium" | "high" | "critical";
  retryable: boolean;
};

class RecordTimeoutError extends Error {}

/**
 * Recording a failure must never make the failure worse (KAN-28, MON-16).
 *
 * This runs inside customer requests (a call being answered, a payment
 * webhook), usually at the moment something is already going wrong, and writes
 * to the same database those requests depend on. So:
 *  - it never throws;
 *  - it never holds the request up for longer than `timeoutMs`;
 *  - after a failed or timed-out write it stops attempting writes for a while
 *    (longer each consecutive time) instead of adding load to a database that
 *    is struggling. Failures skipped that way are not recorded; the monitor's
 *    own database check is what reports that situation;
 *  - it logs a short code, never the error's own text, which can carry
 *    addresses and credentials.
 */
export function createFailureRecorder(deps: {
  record: (input: FailureRecord) => Promise<unknown>;
  now?: () => number;
  timeoutMs?: number;
  /** Pause after the 1st, 2nd, ... consecutive failure (the last value repeats). */
  breakerMs?: number[];
}) {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? 1_500;
  const breakerMs = deps.breakerMs?.length ? deps.breakerMs : [30_000, 2 * 60_000, 10 * 60_000];
  let failures = 0;
  let pausedUntil = 0;

  return async function recordFailure(input: FailureInput): Promise<void> {
    if (now() < pausedUntil) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = Promise.resolve().then(() =>
        deps.record({
          ...input,
          severity: input.severity ?? "high",
          retryable: input.retryable ?? true,
        }),
      );
      // If the write fails after the timeout has already been counted, the
      // late rejection must not surface as an unhandled one.
      work.catch(() => undefined);
      await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new RecordTimeoutError()), timeoutMs);
        }),
      ]);
      failures = 0;
    } catch (error) {
      failures += 1;
      pausedUntil = now() + breakerMs[Math.min(failures - 1, breakerMs.length - 1)];
      console.warn(
        JSON.stringify({
          event: "tradecatch.reliability.record_skipped",
          code:
            error instanceof RecordTimeoutError
              ? "TIMEOUT"
              : (safeDatabaseErrorCode(error) ?? "UNKNOWN"),
        }),
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

export const recordFailure = createFailureRecorder({
  record: (input) => getReliabilityService().recordError(input),
});
