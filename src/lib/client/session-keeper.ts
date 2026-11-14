/**
 * Keeps a signed-in browser signed in while the short-lived access token
 * (15 minutes, HttpOnly cookie) comes and goes.
 *
 * - Renews about a minute before the access token expires, and again as soon
 *   as the tab is shown or the network comes back after the laptop slept.
 * - Wraps `fetch` for our own `/api/` routes: an answer of 401 triggers one
 *   renewal and one retry of the same request. A request is only ever retried
 *   after the server refused it at the sign-in check, before doing anything.
 * - When renewal is refused (signed out elsewhere, password reset, session
 *   revoked), sends the person to the login page instead of leaving a broken
 *   page.
 *
 * The browser never sees a token: renewal is a POST whose answer only says
 * when the new access token expires. No token is stored in localStorage.
 * No React imports, so it can be unit-tested with a fake window.
 */

export const RENEW_BEFORE_EXPIRY_MS = 60_000;
const MIN_DELAY_MS = 5_000;
const REFRESH_URL = "/api/auth/refresh";

export type RenewOutcome = "renewed" | "signed_out" | "unavailable";

export type KeeperEnv = {
  fetch: typeof fetch;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  /** Same-origin base, e.g. window.location.origin. */
  origin: string;
  onSignedOut: () => void;
};

export function createSessionKeeper(env: KeeperEnv, initialExpiresAt?: number) {
  let expiresAtMs = initialExpiresAt ? initialExpiresAt * 1000 : 0;
  let timer: unknown = null;
  let inflight: Promise<RenewOutcome> | null = null;
  let stopped = false;
  let signedOut = false;
  // The real fetch, captured before the wrapper is installed, so renewal never loops.
  const baseFetch = env.fetch;

  function schedule() {
    if (stopped) return;
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
    if (!expiresAtMs) return;
    const delay = Math.max(
      MIN_DELAY_MS,
      expiresAtMs - RENEW_BEFORE_EXPIRY_MS - env.now(),
    );
    timer = env.setTimeout(() => {
      timer = null;
      void renew();
    }, delay);
  }

  async function doRenew(): Promise<RenewOutcome> {
    try {
      const res = await baseFetch(REFRESH_URL, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          accessExpiresAt?: unknown;
        };
        if (typeof body.accessExpiresAt === "number") {
          expiresAtMs = body.accessExpiresAt * 1000;
        }
        schedule();
        return "renewed";
      }
      if (res.status === 401) {
        if (!signedOut) {
          signedOut = true;
          env.onSignedOut();
        }
        return "signed_out";
      }
      // Rate limited or the service is down: try again shortly, keep the page.
      expiresAtMs = env.now() + RENEW_BEFORE_EXPIRY_MS + 30_000;
      schedule();
      return "unavailable";
    } catch {
      expiresAtMs = env.now() + RENEW_BEFORE_EXPIRY_MS + 30_000;
      schedule();
      return "unavailable";
    }
  }

  /** One renewal at a time; callers arriving meanwhile share its result. */
  function renew(): Promise<RenewOutcome> {
    inflight ??= doRenew().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  /** Renews now if the token is due (tab shown again, network back). */
  function renewIfDue() {
    if (!expiresAtMs || env.now() >= expiresAtMs - RENEW_BEFORE_EXPIRY_MS) {
      void renew();
    }
  }

  function isOwnApi(input: RequestInfo | URL): boolean {
    try {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(raw, env.origin);
      return (
        url.origin === env.origin &&
        url.pathname.startsWith("/api/") &&
        !url.pathname.startsWith("/api/auth/")
      );
    } catch {
      return false;
    }
  }

  /** A fetch that renews the sign-in once and retries when an own API call answers 401. */
  const wrappedFetch: typeof fetch = async (input, init) => {
    if (stopped || !isOwnApi(input)) return baseFetch(input, init);
    // A Request body can be read only once: keep a copy for the retry.
    const retryInput = input instanceof Request ? input.clone() : input;
    const bodyIsStream =
      typeof ReadableStream !== "undefined" &&
      init?.body instanceof ReadableStream;
    const first = await baseFetch(input, init);
    if (first.status !== 401 || bodyIsStream) return first;
    const outcome = await renew();
    if (outcome !== "renewed") return first;
    return baseFetch(retryInput, init);
  };

  schedule();

  return {
    renew,
    renewIfDue,
    fetch: wrappedFetch,
    get expiresAtMs() {
      return expiresAtMs;
    },
    stop() {
      stopped = true;
      if (timer !== null) env.clearTimeout(timer);
      timer = null;
    },
  };
}
