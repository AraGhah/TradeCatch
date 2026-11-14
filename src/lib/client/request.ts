/**
 * One way for the browser to call our API without making an outage worse.
 *
 * What it does that a bare `fetch` does not:
 *  - Reads *why* a request failed, including when the answer did not come from
 *    us. Cloudflare answers for the Worker with its own pages: Error 1015 (rate
 *    limited, HTTP 429, HTML), Error 1020 (access denied, HTTP 403, HTML),
 *    "error code: 1102" (the Worker ran out of resources, HTTP 503, plain
 *    text). Calling `response.json()` on those throws, so every caller used to
 *    see "something went wrong" with no way to tell "wait a minute" from "you
 *    are blocked".
 *  - Obeys `Retry-After`, and remembers it. After a 429 it sends nothing more
 *    to that route (or, for Cloudflare's own 429, to the site) until the time
 *    is up. Hammering a rate limiter only keeps the limit in force.
 *  - Retries only what is safe, with exponential backoff and full jitter, so a
 *    thousand browsers that were refused together do not come back together.
 *  - Shares one in-flight GET between callers asking for the same thing.
 *
 * What it will not do: retry a write that might have been done. A refused
 * request (429) never ran, so any method may be retried after its wait. A
 * network error or 5xx may or may not have run, so a write is retried then
 * only when the caller says the server de-duplicates it (`idempotent: true`),
 * i.e. the request carries an idempotency key the server enforces.
 */

export type ApiErrorKind =
  /** Too many requests: ours (429 JSON) or Cloudflare's (Error 1015). Wait `retryAfterMs`. */
  | "rate_limited"
  /** Refused by Cloudflare's firewall (Error 1020, a challenge, a ban). Retrying will not help. */
  | "blocked"
  /** The site is briefly unavailable (502/503/504, Cloudflare 52x, Error 1102). Retrying may help. */
  | "unavailable"
  /** The request never got an answer: offline, DNS, timeout. */
  | "network"
  | "unauthorized"
  | "forbidden"
  /** Any other 4xx: the request was wrong. Retrying will not help. */
  | "client"
  /** 500: our bug. */
  | "server"
  /** A success status with a body that is not the JSON we expected. */
  | "invalid_response";

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number,
    message: string,
    readonly details: {
      /** How long to wait before trying again, when the server said. */
      retryAfterMs?: number;
      /** Who answered. "cloudflare" means the request never reached our code. */
      source?: "app" | "cloudflare" | "browser";
      /** The Cloudflare error number (1015, 1020, 1102, 520...), when there was one. */
      cloudflareCode?: number;
      /** The parsed JSON body, when the app answered with one. */
      body?: unknown;
      /** True when no request was sent because a recent 429 is still in force. */
      cooling?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  get retryAfterMs(): number | undefined {
    return this.details.retryAfterMs;
  }
  get source() {
    return this.details.source;
  }
  get cloudflareCode(): number | undefined {
    return this.details.cloudflareCode;
  }
  get body(): unknown {
    return this.details.body;
  }
  /** True when trying the same request again later could work. */
  get retryable(): boolean {
    return (
      this.kind === "rate_limited" ||
      this.kind === "unavailable" ||
      this.kind === "network"
    );
  }
}

// --- Reading Cloudflare's own answers ---------------------------------------

export type EdgeError = {
  /** Cloudflare's error number, 0 when it did not say. */
  code: number;
  kind: "rate_limited" | "blocked" | "unavailable";
};

const BLOCKED_CODES = new Set([
  1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1020, 1106,
]);
const RESOURCE_CODES = new Set([1101, 1102, 1103, 1104, 1105]);

/**
 * Recognises a response that Cloudflare produced instead of our app. Our own
 * answers are JSON; Cloudflare's are HTML or the plain text `error code: 1102`.
 * Returns null for anything that is not clearly Cloudflare's.
 */
export function detectCloudflareEdgeError(
  status: number,
  headers: Pick<Headers, "get">,
  text: string,
): EdgeError | null {
  const type = headers.get("content-type") ?? "";
  if (/json/i.test(type)) return null;

  if (headers.get("cf-mitigated")) return { code: 0, kind: "blocked" };

  const fromCloudflare =
    /cloudflare/i.test(headers.get("server") ?? "") ||
    headers.get("cf-ray") !== null ||
    /cloudflare|cf-error-details|cf-wrapper/i.test(text.slice(0, 4_000));
  const named =
    /error code[:\s]+(\d{3,4})\b/i.exec(text) ??
    /\bError\s+(1\d{3}|5\d{2})\b/i.exec(text) ??
    /cf-error-code[^>]*>\s*(\d{3,4})\s*</i.exec(text);
  const code = named ? Number(named[1]) : 0;

  if (!fromCloudflare && !named) return null;
  if (code === 1015 || (!code && status === 429)) {
    return { code, kind: "rate_limited" };
  }
  if (BLOCKED_CODES.has(code) || (!code && status === 403)) {
    return { code, kind: "blocked" };
  }
  if (RESOURCE_CODES.has(code) || (code >= 520 && code <= 530)) {
    return { code, kind: "unavailable" };
  }
  if (status === 429) return { code, kind: "rate_limited" };
  if (status === 403) return { code, kind: "blocked" };
  if (status >= 500) return { code, kind: "unavailable" };
  return null;
}

/** `Retry-After` as milliseconds: a number of seconds or an HTTP date. Null when absent or unreadable. */
export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.min(Math.round(Number(trimmed) * 1_000), MAX_WAIT_MS);
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(0, date - now), MAX_WAIT_MS);
}

const MAX_WAIT_MS = 60 * 60 * 1_000;

/**
 * Exponential backoff with full jitter: a random wait between 0 and
 * `base * 2^attempt` (capped). Spreading retries over the whole range, rather
 * than adding a little noise to a fixed delay, is what stops clients that were
 * refused together from coming back together.
 */
export function backoffDelay(
  attempt: number,
  random: () => number = Math.random,
  baseMs = 500,
  capMs = 30_000,
): number {
  return Math.floor(random() * Math.min(capMs, baseMs * 2 ** attempt));
}

// --- The requester -------------------------------------------------------------

export type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  /** Sent as JSON. */
  body?: unknown;
  /** Give up on one attempt after this long. Default 15 s. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * The server de-duplicates this request (it carries an idempotency key it
   * enforces), so it is safe to retry after a network error or 5xx.
   */
  idempotent?: boolean;
  /** Extra attempts after the first. Default 2 for GET/HEAD, 0 for writes. */
  retries?: number;
  /** Longest wait this call will sit out by itself. Default 20 s; longer is reported to the caller. */
  maxWaitMs?: number;
  /** Share one in-flight request between identical callers. Default on for GET without a signal. */
  dedupe?: boolean;
};

export type RequesterDeps = {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  now: () => number;
};

const RETRYABLE_STATUS = new Set([502, 503, 504, 520, 521, 522, 523, 524, 527]);

function messageFor(kind: ApiErrorKind, status: number): string {
  switch (kind) {
    case "rate_limited":
      return "Too many requests. Please wait a moment and try again.";
    case "blocked":
      return "This request was blocked. Please contact support if this keeps happening.";
    case "unavailable":
      return "The service is briefly unavailable. Please try again.";
    case "network":
      return "Could not reach the server. Check your connection and try again.";
    case "unauthorized":
      return "Please sign in again.";
    case "forbidden":
      return "You do not have access to this.";
    case "invalid_response":
      return "The server sent an unexpected answer.";
    default:
      return `Request failed (${status}).`;
  }
}

export function createRequester(deps: Partial<RequesterDeps> = {}): {
  request<T = unknown>(url: string, options?: RequestOptions): Promise<T>;
  /** Forget remembered waits and in-flight requests (tests). */
  reset(): void;
} {
  const doFetch = deps.fetch ?? ((...args) => globalThis.fetch(...args));
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const now = deps.now ?? (() => Date.now());

  // Waits we were told to sit out. "edge" is Cloudflare's own rate limit,
  // which covers the whole site; the rest are per route.
  const cooldowns = new Map<string, number>();
  const inFlight = new Map<string, Promise<unknown>>();

  const scopeOf = (method: string, url: string) => {
    try {
      return `${method} ${new URL(url, "https://site.invalid").pathname}`;
    } catch {
      return `${method} ${url}`;
    }
  };

  function cooling(scope: string): number {
    const until = Math.max(
      cooldowns.get("edge") ?? 0,
      cooldowns.get(scope) ?? 0,
    );
    return Math.max(0, until - now());
  }

  async function attempt<T>(
    url: string,
    method: string,
    options: RequestOptions,
  ): Promise<T> {
    const scope = scopeOf(method, url);
    const left = cooling(scope);
    if (left > 0) {
      throw new ApiError("rate_limited", 429, messageFor("rate_limited", 429), {
        retryAfterMs: left,
        source: "browser",
        cooling: true,
      });
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 15_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) controller.abort();

    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(options.body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
          ...options.headers,
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ApiError("network", 0, messageFor("network", 0), {
        source: "browser",
      });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }

    let text = "";
    try {
      text = await response.text();
    } catch {
      throw new ApiError("network", response.status, messageFor("network", 0), {
        source: "browser",
      });
    }
    const retryAfterMs = parseRetryAfter(
      response.headers.get("retry-after"),
      now(),
    );

    if (response.ok) {
      if (text === "") return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new ApiError(
          "invalid_response",
          response.status,
          messageFor("invalid_response", response.status),
          { source: "app" },
        );
      }
    }

    // Not a success: work out who answered, and what they are telling us.
    const edge = detectCloudflareEdgeError(
      response.status,
      response.headers,
      text,
    );
    let body: unknown;
    if (!edge && /json/i.test(response.headers.get("content-type") ?? "")) {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
    }
    const bodyWait =
      typeof (body as { retryAfterSeconds?: unknown } | undefined)
        ?.retryAfterSeconds === "number"
        ? (body as { retryAfterSeconds: number }).retryAfterSeconds * 1_000
        : null;
    const source = edge ? "cloudflare" : "app";

    let kind: ApiErrorKind;
    if (edge) kind = edge.kind;
    else if (response.status === 429) kind = "rate_limited";
    else if (response.status === 401) kind = "unauthorized";
    else if (response.status === 403) kind = "forbidden";
    else if (RETRYABLE_STATUS.has(response.status)) kind = "unavailable";
    else if (response.status >= 500) kind = "server";
    else kind = "client";

    const wait = retryAfterMs ?? bodyWait ?? undefined;
    if (kind === "rate_limited") {
      // Cloudflare's 1015 says nothing about how long; treat it as a minute so
      // the browser stops feeding the limit. Our own 429 always says.
      const waitMs = wait ?? (edge ? 60_000 : 5_000);
      cooldowns.set(edge ? "edge" : scope, now() + waitMs);
      throw new ApiError(
        "rate_limited",
        response.status,
        messageFor(kind, response.status),
        {
          retryAfterMs: waitMs,
          source,
          cloudflareCode: edge?.code || undefined,
          body,
        },
      );
    }
    throw new ApiError(
      kind,
      response.status,
      messageFor(kind, response.status),
      {
        retryAfterMs: wait,
        source,
        cloudflareCode: edge?.code || undefined,
        body,
      },
    );
  }

  async function run<T>(url: string, options: RequestOptions): Promise<T> {
    const method = (options.method ?? "GET").toUpperCase();
    const safeToRepeat = method === "GET" || method === "HEAD";
    const retries = options.retries ?? (safeToRepeat ? 2 : 0);
    const maxWaitMs = options.maxWaitMs ?? 20_000;

    for (let tries = 0; ; tries += 1) {
      try {
        return await attempt<T>(url, method, options);
      } catch (error) {
        if (!(error instanceof ApiError) || tries >= retries) throw error;
        // A 429 was refused before it ran, so any method may repeat it. Other
        // transient failures may have run: only repeat what cannot do harm.
        const refusedBeforeRunning = error.kind === "rate_limited";
        const mayRepeat =
          refusedBeforeRunning ||
          ((error.kind === "unavailable" || error.kind === "network") &&
            (safeToRepeat || options.idempotent === true));
        if (!mayRepeat || error.details.cooling) throw error;

        const told = error.retryAfterMs;
        // If the server asked for longer than we are willing to sit here, tell
        // the caller instead of holding the screen.
        if (told !== undefined && told > maxWaitMs) throw error;
        const jittered = backoffDelay(tries, random);
        const waitMs =
          told !== undefined ? told + Math.floor(random() * 250) : jittered;
        await sleep(waitMs);
      }
    }
  }

  return {
    request<T = unknown>(
      url: string,
      options: RequestOptions = {},
    ): Promise<T> {
      const method = (options.method ?? "GET").toUpperCase();
      const dedupe =
        options.dedupe ?? (method === "GET" && options.signal === undefined);
      if (!dedupe) return run<T>(url, options);
      const key = `${method} ${url}`;
      const existing = inFlight.get(key);
      if (existing) return existing as Promise<T>;
      const started = run<T>(url, options).finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, started);
      return started;
    },
    reset() {
      cooldowns.clear();
      inFlight.clear();
    },
  };
}

const shared = createRequester();

/** Call our API as JSON. Throws `ApiError`; see the file comment. */
export const requestJson = shared.request;
