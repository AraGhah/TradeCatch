/**
 * `fetch` that cannot hang forever.
 *
 * A bare `fetch` has no timeout: a connection that stalls (a phone going into a
 * tunnel, a Worker that never answers) leaves the promise pending for minutes
 * or for good, and with it a "Saving…" button that never comes back. This is a
 * drop-in with the same arguments and the same `Response`, plus one option,
 * `timeoutMs`. When the time is up the request is aborted and the promise
 * rejects with a `RequestTimeoutError`, so every caller's existing `catch`
 * clears its loading state.
 *
 * It does not retry, and it does not read the body. For retries, Retry-After and
 * rate-limit cooldowns use `requestJson` in `./request`.
 *
 * Only the wait for the response (headers) is timed here. The whole of an
 * action, body included, is bounded by `useAction` in `./use-action`.
 */

/** How long a normal request may take before the person is told. */
export const DEFAULT_TIMEOUT_MS = 30_000;

export class RequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The request did not finish within ${timeoutMs} ms.`);
    this.name = "TimeoutError";
  }
}

export type TimedRequestInit = RequestInit & {
  /** Give up after this long. Default 30 s. */
  timeoutMs?: number;
};

export function timedFetch(
  input: RequestInfo | URL,
  init: TimedRequestInit = {},
  fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = init;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  const done = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  };

  return fetchImpl(input, { ...rest, signal: controller.signal }).then(
    (response) => {
      done();
      return response;
    },
    (error: unknown) => {
      done();
      // Our own timeout is named; the caller's own abort and real network
      // errors pass through unchanged.
      if (timedOut) throw new RequestTimeoutError(timeoutMs);
      throw error;
    },
  );
}
