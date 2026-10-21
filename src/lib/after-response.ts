import { after } from "next/server";

/**
 * Runs `task` once the response has been sent (Next `after`, which Workers
 * keep alive with `waitUntil`) so work that must not be lost is not left as a
 * dangling promise. Outside a request scope (scripts, tests) it runs inline.
 * A failure is logged, never thrown into the caller.
 */
export function runAfterResponse(task: () => Promise<void>): Promise<void> {
  const guarded = async () => {
    try {
      await task();
    } catch (error) {
      console.warn(
        "[after-response] task failed",
        error instanceof Error ? error.message : "unknown",
      );
    }
  };
  try {
    after(guarded);
    return Promise.resolve();
  } catch {
    return guarded();
  }
}
