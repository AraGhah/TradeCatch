"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Lets a task run once at a time. A second call made while the first is
 * running (a double click, a held Enter key, an impatient third tap) is
 * dropped instead of starting a second request.
 *
 * This cannot be done with `useState` alone: two clicks in the same tick both
 * read the old `false` before React re-renders the button as disabled. The
 * lock is a plain object, set synchronously.
 */
export function createSingleFlight() {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    /** Runs `task` unless one is already running. Resolves to its result, or `undefined` when dropped. */
    async run<T>(task: () => Promise<T>): Promise<T | undefined> {
      if (busy) return undefined;
      busy = true;
      try {
        return await task();
      } finally {
        busy = false;
      }
    },
  };
}

/** React wrapper: `run` for the handler, `pending` for `disabled` / `aria-busy`. */
export function useSingleFlight() {
  const flight = useRef(createSingleFlight());
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(async <T>(task: () => Promise<T>) => {
    if (flight.current.busy) return undefined;
    setPending(true);
    try {
      return await flight.current.run(task);
    } finally {
      if (mounted.current) setPending(false);
    }
  }, []);
  return { run, pending };
}

/** A submit event: dropping it must still stop the browser's own form submission. */
function stopNativeSubmit(args: unknown[]) {
  const event = args[0] as
    { type?: unknown; preventDefault?: unknown } | undefined;
  if (event?.type === "submit" && typeof event.preventDefault === "function") {
    (event.preventDefault as () => void).call(event);
  }
}

/**
 * Wraps an event handler so a second call made while the first is still
 * running is dropped. The lock is a plain object set synchronously, so it holds
 * for fifty clicks in the same tick, which a `disabled` button (applied only
 * after React re-renders) does not.
 *
 * A dropped `submit` event is still `preventDefault()`ed. The handler normally
 * does that itself, but a handler that never runs cannot, and the browser would
 * then submit the form natively and reload the page.
 *
 * Resolves to the handler's result, or `undefined` when the call was dropped.
 */
export function createGuardedHandler<A extends unknown[], R>(
  flight: ReturnType<typeof createSingleFlight>,
  current: () => (...args: A) => Promise<R> | R,
): (...args: A) => Promise<R | undefined> {
  return (...args: A) => guardedCall(flight, current(), args);
}

function guardedCall<A extends unknown[], R>(
  flight: ReturnType<typeof createSingleFlight>,
  handler: (...args: A) => Promise<R> | R,
  args: A,
): Promise<R | undefined> {
  stopNativeSubmit(args);
  return flight.run(async () => handler(...args));
}

/** `createGuardedHandler` for a component: the returned function is stable and always calls the latest `handler`. */
export function useGuarded<A extends unknown[], R>(
  handler: (...args: A) => Promise<R> | R,
): (...args: A) => Promise<R | undefined> {
  const flight = useRef(createSingleFlight());
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  // The refs are read only when the person acts, never while rendering.
  return useCallback(
    (...args: A) => guardedCall(flight.current, latest.current, args),
    [],
  );
}

/**
 * A wait the person can see: after a 429 the button stays disabled until the
 * server's Retry-After has passed. `start(ms)` begins it; `secondsLeft` is 0
 * when it is over.
 */
export function useCooldown() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (until <= 0) return undefined;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [until]);
  const start = useCallback((ms: number) => setUntil(Date.now() + ms), []);
  const secondsLeft = until > now ? Math.ceil((until - now) / 1000) : 0;
  return { secondsLeft, start };
}
