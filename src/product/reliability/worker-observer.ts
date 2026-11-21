import type { BucketSink, Observer } from "./observations";

/**
 * The Worker entry point's side of request monitoring (KAN-28).
 *
 * Imported by worker.ts, so it must stay small and must not import database
 * code: the counters travel to the database through an authenticated internal
 * route (see createIngestSink), which runs inside the app where the database
 * driver already lives.
 *
 * Nothing here is allowed to change what a customer receives. A recorder that
 * throws, a flush that fails or hangs, and a scheduler that refuses work are all
 * absorbed; the response (or the original error) always goes out unchanged.
 */

export async function observeRequest(deps: {
  observer: Observer;
  request: Request;
  handle: () => Promise<Response>;
  now?: () => number;
  /** Runs work after the response has been sent (ctx.waitUntil). */
  schedule: (work: Promise<unknown>) => void;
  /** Writes the buffered counters. May reject; the rejection is absorbed. */
  flush: () => Promise<unknown>;
}): Promise<Response> {
  const now = deps.now ?? Date.now;
  const started = now();

  const record = (status: number) => {
    try {
      deps.observer.record({
        pathname: new URL(deps.request.url).pathname,
        status,
        durationMs: now() - started,
      });
    } catch {
      // never affects the request
    }
  };
  const flushIfDue = () => {
    try {
      if (!deps.observer.due()) return;
      deps.schedule(
        Promise.resolve()
          .then(deps.flush)
          .catch(() => undefined),
      );
    } catch {
      // never affects the request
    }
  };

  let response: Response;
  try {
    response = await deps.handle();
  } catch (error) {
    // The platform will answer 5xx for an uncaught exception; count it too.
    record(500);
    flushIfDue();
    throw error;
  }
  record(response.status);
  flushIfDue();
  return response;
}

/**
 * Carries buffered counters to the app's ingest route. Rejects on anything but
 * a success answer so the observer's circuit breaker backs off a database that
 * is struggling instead of hammering it.
 */
export function createIngestSink(deps: {
  origin: string;
  secret: string | undefined;
  fetchInternal: (request: Request) => Promise<Response>;
}): BucketSink {
  return async (rows) => {
    const secret = deps.secret?.trim();
    if (!secret) throw new Error("monitoring secret not configured");
    const response = await deps.fetchInternal(
      new Request(new URL("/api/monitoring/ingest", deps.origin), {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
          "user-agent": "TradeCatch-Worker-Monitor/1.0",
        },
        body: JSON.stringify({ rows }),
      }),
    );
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) throw new Error(`ingest answered ${response.status}`);
  };
}
