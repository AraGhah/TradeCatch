"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./request";
import { RequestTimeoutError, DEFAULT_TIMEOUT_MS } from "./timed-fetch";
import { createSingleFlight } from "./use-single-flight";

/**
 * One way to run a person's action (save, sign in, book, pay) so that every
 * screen behaves the same:
 *
 *  - one at a time: a second call while one is running is dropped, even when it
 *    arrives in the same tick as the first (fifty clicks, a held Enter key);
 *  - it always ends: a task that never answers is cut off after `timeoutMs`, so
 *    a spinner or a disabled button cannot outlive the request;
 *  - it says what happened: success, or a `Failure` that tells the screen what
 *    kind of failure it was and whether trying again is safe;
 *  - it leaves quietly: if the person navigates away, the request is aborted and
 *    nothing is written to the screen that is gone.
 *
 * This builds on `createSingleFlight` (the lock) and `ApiError` (what
 * `requestJson` throws). It does not replace either.
 */

export type FailureKind =
  /** No answer in time. For a write, whether it ran is unknown. */
  | "timeout"
  /** Never reached the server (offline, DNS, dropped). */
  | "network"
  | "rate_limited"
  /** Refused by Cloudflare's firewall. Retrying will not help. */
  | "blocked"
  /** Briefly unavailable (502/503/504, Worker out of resources). */
  | "unavailable"
  | "unauthorized"
  | "forbidden"
  /** The details were wrong (400/422). Retrying the same details will not help. */
  | "invalid"
  /** The thing changed under us (409). */
  | "conflict"
  /** 500: our bug. */
  | "server"
  | "unknown";

export type Failure = {
  kind: FailureKind;
  status: number;
  /** Wait this long before trying again, when the server said. */
  retryAfterMs?: number;
  /** The parsed JSON body, when the server sent one. */
  body?: unknown;
  /**
   * A write that timed out or lost its connection may have been done anyway.
   * Show "we could not confirm", never "failed", and refresh what is on screen.
   */
  outcomeUnknown: boolean;
  /** Offering "Try again" is safe: it cannot do the thing twice. */
  retrySafe: boolean;
};

export type ActionOptions = {
  /** Cut the task off after this long. Default 30 s. */
  timeoutMs?: number;
  /** The task changes something. Decides how a timeout is reported. */
  write?: boolean;
  /**
   * The server de-duplicates this write (idempotency key, version check, or a
   * claim), so repeating it after an unknown outcome is harmless.
   */
  idempotent?: boolean;
};

export type ActionOutcome<T> =
  | { status: "ok"; value: T }
  | { status: "failed"; failure: Failure }
  /** Another run was already in flight; nothing was started. */
  | { status: "dropped" }
  /** Aborted because the screen went away. Do not touch the screen. */
  | { status: "cancelled" };

/** The task did not finish in time. Thrown by the runner, never by `fetch`. */
export class ActionTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The action did not finish within ${timeoutMs} ms.`);
    this.name = "TimeoutError";
  }
}

function build(
  kind: FailureKind,
  status: number,
  options: ActionOptions,
  extra: Partial<Pick<Failure, "retryAfterMs" | "body">> = {},
): Failure {
  const write = options.write === true;
  const outcomeUnknown = write && (kind === "timeout" || kind === "network");
  const retryable =
    kind === "timeout" ||
    kind === "network" ||
    kind === "unavailable" ||
    kind === "rate_limited" ||
    kind === "server" ||
    kind === "unknown";
  return {
    kind,
    status,
    ...extra,
    outcomeUnknown,
    retrySafe: retryable && (!outcomeUnknown || options.idempotent === true),
  };
}

/** A failure from an HTTP status, for code that reads the response itself. */
export function failureFromStatus(
  status: number,
  options: ActionOptions & { retryAfterMs?: number; body?: unknown } = {},
): Failure {
  const extra = { retryAfterMs: options.retryAfterMs, body: options.body };
  if (status === 401) return build("unauthorized", status, options, extra);
  if (status === 403) return build("forbidden", status, options, extra);
  if (status === 409) return build("conflict", status, options, extra);
  if (status === 429) return build("rate_limited", status, options, extra);
  if (status === 408 || status === 504)
    return build("timeout", status, options, extra);
  if (status === 502 || status === 503)
    return build("unavailable", status, options, extra);
  if (status >= 500) return build("server", status, options, extra);
  if (status >= 400) return build("invalid", status, options, extra);
  return build("unknown", status, options, extra);
}

/** Turns anything a task can throw into a `Failure`. */
export function classifyFailure(
  error: unknown,
  options: ActionOptions = {},
): Failure {
  if (
    error instanceof ActionTimeoutError ||
    error instanceof RequestTimeoutError
  ) {
    return build("timeout", 0, options);
  }
  if (error instanceof ApiError) {
    const extra = { retryAfterMs: error.retryAfterMs, body: error.body };
    switch (error.kind) {
      case "rate_limited":
        return build("rate_limited", error.status, options, extra);
      case "blocked":
        return build("blocked", error.status, options, extra);
      case "unavailable":
        return build("unavailable", error.status, options, extra);
      case "network":
        // `requestJson` also reports its own 15 s timeout as "network".
        return build("network", 0, options, extra);
      case "unauthorized":
        return build("unauthorized", error.status, options, extra);
      case "forbidden":
        return build("forbidden", error.status, options, extra);
      case "server":
        return build("server", error.status, options, extra);
      case "invalid_response": {
        // A success status with an answer nobody could read: the server may well
        // have done the work, so for a write that is an unknown outcome, not a failure.
        const failure = build("server", error.status, options, extra);
        const answeredOk = error.status >= 200 && error.status < 300;
        if (!options.write || !answeredOk) return failure;
        return {
          ...failure,
          outcomeUnknown: true,
          retrySafe: options.idempotent === true,
        };
      }
      default:
        return failureFromStatus(error.status, { ...options, ...extra });
    }
  }
  const named = (error as { name?: string } | null)?.name;
  if (named === "TimeoutError") return build("timeout", 0, options);
  // `fetch` rejects with a TypeError when nothing was received at all.
  if (error instanceof TypeError) return build("network", 0, options);
  if (named === "AbortError") return build("network", 0, options);
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status > 0) {
    return failureFromStatus(status, options);
  }
  return build("unknown", 0, options);
}

/**
 * The framework-free core of `useAction`. One runner per button or form.
 * Exported so it can be tested without a browser.
 */
export function createActionRunner() {
  const flight = createSingleFlight();
  let current: AbortController | null = null;
  let cancelled = false;

  return {
    get busy() {
      return flight.busy;
    },
    /** Aborts the running task, if any. Its outcome is `cancelled`. */
    abort() {
      if (!current) return;
      cancelled = true;
      current.abort();
    },
    async run<T>(
      task: (signal: AbortSignal) => Promise<T>,
      options: ActionOptions = {},
    ): Promise<ActionOutcome<T>> {
      const outcome = await flight.run<ActionOutcome<T>>(async () => {
        const controller = new AbortController();
        current = controller;
        cancelled = false;
        const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new ActionTimeoutError(timeoutMs));
          }, timeoutMs);
        });
        try {
          // The race is what guarantees an end: a task that ignores its signal
          // and never settles still loses to the timer.
          const value = await Promise.race([task(controller.signal), timeout]);
          return cancelled ? { status: "cancelled" } : { status: "ok", value };
        } catch (error) {
          if (cancelled) return { status: "cancelled" };
          return { status: "failed", failure: classifyFailure(error, options) };
        } finally {
          clearTimeout(timer);
          current = null;
        }
      });
      // `undefined` is what the lock returns for a call it dropped.
      return outcome ?? { status: "dropped" };
    },
  };
}

export type ActionState = {
  pending: boolean;
  /** The failure of the latest run, until the next run starts or `reset()`. */
  failure: Failure | null;
};

/**
 * `run(task)` for the handler; `pending` for `disabled` / `aria-busy` / the
 * spinner; `failure` for the message. Returns the outcome so the handler can
 * act on success (`outcome.status === "ok"`) without a second state variable.
 *
 * Put the result in state *after* `run` returns, from `outcome.value`, not
 * inside the task: a task that was cut off by the timeout may still finish
 * later, and its late result must not reach the screen.
 */
export function useAction() {
  const runner = useRef<ReturnType<typeof createActionRunner> | null>(null);
  const mounted = useRef(true);
  const [state, setState] = useState<ActionState>({
    pending: false,
    failure: null,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runner.current?.abort();
    };
  }, []);

  const run = useCallback(
    async <T>(
      task: (signal: AbortSignal) => Promise<T>,
      options?: ActionOptions,
    ): Promise<ActionOutcome<T>> => {
      runner.current ??= createActionRunner();
      // Checked before any state is touched: a dropped call changes nothing.
      if (runner.current.busy) return { status: "dropped" };
      setState({ pending: true, failure: null });
      const outcome = await runner.current.run(task, options);
      if (
        mounted.current &&
        outcome.status !== "dropped" &&
        outcome.status !== "cancelled"
      ) {
        setState({
          pending: false,
          failure: outcome.status === "failed" ? outcome.failure : null,
        });
      }
      return outcome;
    },
    [],
  );

  const reset = useCallback(
    () => setState((s) => (s.failure ? { ...s, failure: null } : s)),
    [],
  );

  return { run, reset, pending: state.pending, failure: state.failure };
}
