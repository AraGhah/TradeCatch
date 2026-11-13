import { ApiError } from "./request";

/**
 * Background polling that cannot turn into a request storm.
 *
 * What a bare `setInterval(fetch, 20_000)` gets wrong, and this does not:
 *  - It keeps asking while the server is struggling. After a failure this backs
 *    off exponentially (with jitter) up to `maxBackoffMs`, and after a 429 it
 *    waits at least as long as `Retry-After` said.
 *  - It overlaps: a slow answer plus a fixed interval stacks requests. Here the
 *    next run is scheduled only when the last one has finished, and `poke()`
 *    while one is running does nothing.
 *  - It runs in tabs nobody is looking at. It pauses while the tab is hidden
 *    (and while the browser is offline) and runs once as the tab comes back.
 *  - Every tab fires on the same beat. Each wait is randomised by +/- `jitter`/2.
 *  - It never stops on its own. A 401 means the session ended: it stops.
 */

export type PollerOptions = {
  intervalMs: number;
  /** Total spread of each wait as a fraction of the interval. Default 0.2 (+/-10%). */
  jitter?: number;
  /** Longest wait after repeated failures. Default 5 minutes. */
  maxBackoffMs?: number;
  /** Fewest milliseconds between two runs, however they were triggered. Default 5 s. */
  minGapMs?: number;
};

export type PollerDeps = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  random: () => number;
  now: () => number;
  isHidden: () => boolean;
  isOffline: () => boolean;
  /** Calls `onShow` whenever the tab becomes visible or the browser comes back online. Returns an unsubscribe. */
  onWake: (onShow: () => void) => () => void;
};

const browserDeps = (): PollerDeps => ({
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
  random: Math.random,
  now: () => Date.now(),
  isHidden: () => document.visibilityState === "hidden",
  isOffline: () =>
    typeof navigator !== "undefined" && navigator.onLine === false,
  onWake: (onShow) => {
    const visible = () => {
      if (document.visibilityState === "visible") onShow();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", onShow);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", onShow);
    };
  },
});

export type Poller = {
  /** Begin polling. `immediate` runs once now instead of after the first interval. */
  start(options?: { immediate?: boolean }): void;
  /** Run now if nothing is running and the minimum gap has passed (after a user action, say). */
  poke(): void;
  stop(): void;
};

export function createPoller(
  run: (signal: AbortSignal) => Promise<void>,
  options: PollerOptions,
  overrides: Partial<PollerDeps> = {},
): Poller {
  const deps = {
    ...(typeof window === "undefined" ? {} : browserDeps()),
    ...overrides,
  } as PollerDeps;
  const jitter = options.jitter ?? 0.2;
  const maxBackoffMs = options.maxBackoffMs ?? 5 * 60_000;
  const minGapMs = options.minGapMs ?? 5_000;

  let timer: unknown = null;
  let running: AbortController | null = null;
  let stopped = true;
  let failures = 0;
  let lastStartedAt = -Infinity;
  let unsubscribe: (() => void) | null = null;

  const clear = () => {
    if (timer !== null) deps.clearTimeout(timer);
    timer = null;
  };

  function waitAfter(error: unknown): number {
    const spread = 1 + (deps.random() - 0.5) * jitter;
    if (failures === 0) return Math.round(options.intervalMs * spread);
    // Equal jitter: at least half the backoff, so a failing server is not
    // asked again within a second, and still spread so tabs do not move together.
    const backoff = Math.min(maxBackoffMs, options.intervalMs * 2 ** failures);
    const wait = Math.round(backoff * (0.5 + deps.random() * 0.5));
    const told = error instanceof ApiError ? (error.retryAfterMs ?? 0) : 0;
    return Math.max(wait, told);
  }

  function schedule(ms: number) {
    clear();
    if (stopped) return;
    timer = deps.setTimeout(() => {
      timer = null;
      void tick();
    }, ms);
  }

  async function tick() {
    if (stopped || running) return;
    // Nobody is looking: do not ask. onWake brings it back.
    if (deps.isHidden() || deps.isOffline()) return;
    lastStartedAt = deps.now();
    const controller = new AbortController();
    running = controller;
    let failure: unknown = null;
    try {
      await run(controller.signal);
      failures = 0;
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.kind === "unauthorized") {
        stopped = true;
        return;
      }
      failures += 1;
      failure = error;
    } finally {
      if (running === controller) running = null;
    }
    schedule(waitAfter(failure));
  }

  function poke() {
    if (stopped || running) return;
    if (deps.now() - lastStartedAt < minGapMs) return;
    clear();
    void tick();
  }

  return {
    start(startOptions = {}) {
      if (!stopped) return;
      stopped = false;
      failures = 0;
      // Back in view (or back online): catch up now if the last run is old
      // enough; poke() ignores it while a run is in progress or too recent.
      unsubscribe = deps.onWake(poke);
      if (startOptions.immediate) void tick();
      else schedule(waitAfter(null));
    },
    poke,
    stop() {
      stopped = true;
      clear();
      running?.abort();
      running = null;
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
