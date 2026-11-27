/**
 * The browser half of the header's profile icon.
 *
 * The icon has to send a signed-out visitor to sign in, a customer to their
 * dashboard and an administrator to the admin dashboard. The browser cannot
 * read the sign-in cookies (they are HttpOnly) and must not decide roles, so it
 * asks the server (GET /api/auth/session) and only ever navigates to the
 * address the server names.
 *
 * - One question at a time: everything that needs the answer shares the same
 *   request, so a fast double click or ten rapid clicks cost one request.
 * - Nothing is decided while the question is open. Activating the icon waits for
 *   the answer, so a person who is signed in is never sent to sign in because
 *   the check had not finished.
 * - The answer is checked again when the icon is activated, never trusted from
 *   an earlier page view: a session that ended meanwhile (signed out in another
 *   tab, expired, revoked) sends the person to sign in, not to a dashboard that
 *   would bounce them.
 * - If the check cannot be completed (offline, server error), the icon goes to
 *   the last place it knew, or else the sign-in page. The sign-in page and the
 *   dashboards verify the session themselves, so this is never a security
 *   decision, only a link.
 *
 * No React imports, so it can be unit-tested with a fake `fetch`.
 */

export type AccountRole = "customer" | "admin" | "billing";

export type AccountView =
  | { state: "loading" }
  | { state: "anonymous"; destination: string }
  | { state: "signed_in"; role: AccountRole; destination: string }
  /** The check itself failed. Says nothing about the person. */
  | { state: "unavailable" };

export type AccountSnapshot = {
  view: AccountView;
  /** The icon was activated and the answer has not come back yet. */
  busy: boolean;
};

/**
 * The only pages an answer may send the browser to. The server already sends
 * nothing else; checking again here means even a wrong or tampered answer can
 * never turn the icon into an open redirect.
 */
const DESTINATIONS: ReadonlySet<string> = new Set([
  "/login",
  "/fr/connexion",
  "/app",
  "/fr/app",
  "/admin",
  "/fr/admin",
  "/billing",
  "/fr/facturation",
]);

export function isAccountDestination(value: unknown): value is string {
  return typeof value === "string" && DESTINATIONS.has(value);
}

/** Turns the server's answer into a view; anything unexpected is "unavailable". */
export function parseAccountAnswer(status: number, body: unknown): AccountView {
  if (status !== 200 || typeof body !== "object" || body === null) {
    return { state: "unavailable" };
  }
  const answer = body as Record<string, unknown>;
  if (!isAccountDestination(answer.destination))
    return { state: "unavailable" };
  if (answer.state === "anonymous") {
    return { state: "anonymous", destination: answer.destination };
  }
  if (
    answer.state === "signed_in" &&
    (answer.role === "customer" ||
      answer.role === "admin" ||
      answer.role === "billing")
  ) {
    return {
      state: "signed_in",
      role: answer.role,
      destination: answer.destination,
    };
  }
  return { state: "unavailable" };
}

const CHECK_TIMEOUT_MS = 8_000;

function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(ms)
    : undefined;
}

export type AccountEnv = {
  fetch: typeof fetch;
  locale: "en" | "fr";
  /** Where to go when nothing better is known. */
  loginPath: string;
  navigate: (path: string) => void;
  onChange: (snapshot: AccountSnapshot) => void;
};

export function createAccountSession(env: AccountEnv) {
  let view: AccountView = { state: "loading" };
  let busy = false;
  let inflight: Promise<AccountView> | null = null;
  // Set once a navigation has been started: further activations do nothing.
  let leaving = false;
  let stopped = false;
  // The last answer that named a page, for when a later check cannot be completed.
  let lastKnown: string | null = null;

  function publish() {
    if (!stopped) env.onChange({ view, busy });
  }

  async function ask(): Promise<AccountView> {
    let next: AccountView;
    try {
      const response = await env.fetch(
        `/api/auth/session?locale=${env.locale}`,
        {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
          // A hung connection must not leave the icon stuck waiting.
          signal: timeoutSignal(CHECK_TIMEOUT_MS),
        },
      );
      next = parseAccountAnswer(
        response.status,
        await response.json().catch(() => null),
      );
    } catch {
      next = { state: "unavailable" };
    }
    if (next.state === "signed_in" || next.state === "anonymous") {
      lastKnown = next.destination;
    }
    view = next;
    publish();
    return next;
  }

  /** Asks the server who this is. Callers arriving while a question is open share it. */
  function check(): Promise<AccountView> {
    inflight ??= ask().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  /** The icon was activated: verify the session, then go where it says. */
  async function open(): Promise<void> {
    if (leaving || busy || stopped) return;
    busy = true;
    publish();
    const answer = await check();
    if (stopped) return;
    const target =
      answer.state === "signed_in" || answer.state === "anonymous"
        ? answer.destination
        : (lastKnown ?? env.loginPath);
    leaving = true;
    env.navigate(target);
  }

  /** The page came back from the back/forward cache: it may be stale, and it can be used again. */
  function reset() {
    leaving = false;
    busy = false;
    publish();
    void check();
  }

  return {
    check,
    open,
    reset,
    stop() {
      stopped = true;
    },
  };
}

export type AccountSession = ReturnType<typeof createAccountSession>;
