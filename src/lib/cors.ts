/**
 * Cross-origin (CORS) policy for the API: one place, default deny.
 *
 * TradeCatch's own pages call /api with relative URLs, so ordinary use is
 * same-origin and needs no CORS headers at all. This module exists for the
 * cases where an approved TradeCatch origin (for example www.tradecatch.ca
 * calling tradecatch.ca, or a staging or local frontend) talks to an API on
 * another origin, with cookies.
 *
 * Rules, all enforced here and nowhere else:
 *   - Exact-match allowlist of origins. Never `*`, never a suffix or substring
 *     match, never a reflected Origin that was not on the list.
 *   - Production, staging and development have separate lists. localhost is
 *     only ever allowed outside real production.
 *   - Only the browser-facing API groups (CORS_API_PREFIXES) are offered. Webhooks,
 *     cron ticks, the voice agent, ops and the API-key lead endpoint are
 *     machine-to-machine and never get CORS headers, for any origin.
 *   - Preflights are answered here, before staging Basic auth or any route
 *     auth, because browsers never send credentials on a preflight.
 *   - CORS is not access control. It only decides which web pages may read a
 *     response. Authentication, authorization and the CSRF guard
 *     (src/lib/csrf.ts) still run for every request.
 *
 * No framework imports: this runs in the Edge proxy and in the Worker entry.
 */
import { isE2eHarness } from "./config";
import { resolveTradeCatchEnv } from "./environment";

export type CorsEnv = Record<string, string | undefined>;

/** Origins of the live customer deployment. Used only when the runtime is real production. */
export const PRODUCTION_ORIGINS: readonly string[] = [
  "https://tradecatch.ca",
  "https://www.tradecatch.ca",
];

/** Local dev servers (next dev, next start, Playwright). Never offered in production or staging. */
export const DEVELOPMENT_ORIGINS: readonly string[] = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3100",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3100",
];

/**
 * The API groups the TradeCatch frontend actually calls. Everything else under
 * /api is machine-only and is never offered cross-origin. A prefix ending in
 * "/" matches that subtree; any other entry matches the path or its subtree.
 */
export const CORS_API_PREFIXES: readonly string[] = [
  "/api/auth/",
  "/api/app/",
  "/api/businesses/",
  "/api/billing/",
  "/api/admin/",
  "/api/help/",
  "/api/referrals/",
  "/api/book-audit",
  "/api/website-requests",
  "/api/receptionist/demo",
  "/api/client-error",
];

export const CORS_ALLOWED_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

/** Request headers a TradeCatch frontend may send. Anything else fails the preflight. */
export const CORS_ALLOWED_REQUEST_HEADERS = [
  "Content-Type",
  "Authorization",
  "Accept",
  "Accept-Language",
  "X-Requested-With",
] as const;

/** Response headers a frontend may read: the rate-limit hints on a 429. */
export const CORS_EXPOSED_RESPONSE_HEADERS = [
  "Retry-After",
  "RateLimit-Limit",
  "RateLimit-Remaining",
  "RateLimit-Reset",
] as const;

/** Seconds a browser may cache a preflight answer. Kept short so a policy change lands quickly. */
export const CORS_PREFLIGHT_MAX_AGE_SECONDS = 600;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * The canonical origin for `raw`, or null. Accepts only what a browser sends
 * in an Origin header: lowercase scheme and host, no path, query, fragment,
 * credentials or trailing slash. Strict on purpose: "https://tradecatch.ca/"
 * and "HTTPS://TRADECATCH.CA" are not the same string and do not match.
 */
export function canonicalOrigin(raw: string | null | undefined): string | null {
  if (!raw || raw === "null" || raw.includes("*")) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  return url.origin === raw ? raw : null;
}

type Tier = "production" | "staging" | "development";

function tierOf(env: CorsEnv): Tier {
  // The local Playwright harness runs a production build on localhost; it is a
  // development sandbox for this purpose.
  if (isE2eHarness(env)) return "development";
  return resolveTradeCatchEnv(env);
}

let warned = false;

/**
 * Extra approved origins from CORS_ALLOWED_ORIGINS (comma separated). Each
 * entry must be an exact origin. Anything else is dropped, so a typo or a
 * wildcard narrows the list instead of widening it. Plain http is accepted
 * only for loopback hosts in development; production and staging take https only.
 */
function extraOrigins(env: CorsEnv, tier: Tier): string[] {
  const raw = env.CORS_ALLOWED_ORIGINS?.trim();
  if (!raw) return [];
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const entry of raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    const origin = canonicalOrigin(entry);
    const secure = origin?.startsWith("https://") ?? false;
    const loopback = origin
      ? LOOPBACK_HOSTS.has(new URL(origin).hostname)
      : false;
    if (origin && (secure || (loopback && tier === "development")))
      accepted.push(origin);
    else rejected.push(entry.slice(0, 80));
  }
  if (rejected.length > 0 && !warned) {
    warned = true;
    console.warn(
      JSON.stringify({
        event: "tradecatch.cors.invalid_origins_ignored",
        count: rejected.length,
        hint: "CORS_ALLOWED_ORIGINS entries must be exact https origins (http only for localhost outside production).",
      }),
    );
  }
  return accepted;
}

/** Test hook. */
export function resetCorsWarningForTests() {
  warned = false;
}

/**
 * The approved origins for this deployment. Separate lists per environment:
 * production never includes localhost or a staging host, staging never
 * includes the live origins.
 */
export function allowedCorsOrigins(
  env: CorsEnv = process.env,
): ReadonlySet<string> {
  const tier = tierOf(env);
  const origins = new Set<string>();
  if (tier === "production") {
    for (const origin of PRODUCTION_ORIGINS) origins.add(origin);
  } else if (tier === "staging") {
    // The staging site itself, taken from its own configuration.
    const site = canonicalOrigin(safeOrigin(env.NEXT_PUBLIC_SITE_URL));
    if (site?.startsWith("https://")) origins.add(site);
  } else {
    for (const origin of DEVELOPMENT_ORIGINS) origins.add(origin);
  }
  for (const origin of extraOrigins(env, tier)) origins.add(origin);
  return origins;
}

function safeOrigin(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** True when /api/<path> belongs to a browser-facing group. Cron ticks never qualify. */
export function isCorsApiPath(pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false;
  if (pathname.split("/").includes("tick")) return false;
  return CORS_API_PREFIXES.some((prefix) => {
    if (prefix.endsWith("/")) return pathname.startsWith(prefix);
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
}

export type CorsDecision =
  /** No Origin, or same-origin, or not an /api request: nothing to add. */
  | { kind: "none" }
  /** An approved origin calling an eligible route. */
  | { kind: "allowed"; origin: string; preflight: boolean }
  /** A cross-origin caller that is not approved, or a route that is never offered. */
  | { kind: "denied"; preflight: boolean };

export function corsDecision(input: {
  method: string;
  pathname: string;
  headers: Headers;
  /** Hostnames this deployment answers to (Host, X-Forwarded-Host, public site). */
  selfHosts: ReadonlyArray<string | null | undefined>;
  env?: CorsEnv;
}): CorsDecision {
  if (!input.pathname.startsWith("/api/")) return { kind: "none" };
  const header = input.headers.get("origin");
  if (header === null) return { kind: "none" };

  const preflight =
    input.method.toUpperCase() === "OPTIONS" &&
    input.headers.get("access-control-request-method") !== null;

  // A browser sends Origin on same-origin POSTs too; those are not cross-origin.
  try {
    const host = new URL(header).host;
    if (input.selfHosts.some((self) => self && self === host))
      return { kind: "none" };
  } catch {
    // Unparseable: handled as an unapproved origin below.
  }

  const origin = canonicalOrigin(header);
  if (!origin) return { kind: "denied", preflight };
  if (!isCorsApiPath(input.pathname)) return { kind: "denied", preflight };
  if (!allowedCorsOrigins(input.env ?? process.env).has(origin)) {
    return { kind: "denied", preflight };
  }
  return { kind: "allowed", origin, preflight };
}

/** Adds tokens to a Vary header without repeating any already present. */
export function mergeVary(headers: Headers, ...tokens: string[]): void {
  const present = new Set(
    (headers.get("vary") ?? "")
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
  if (present.has("*")) return;
  const merged = [
    ...(headers
      .get("vary")
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean) ?? []),
  ];
  for (const token of tokens) {
    if (!present.has(token.toLowerCase())) merged.push(token);
  }
  if (merged.length > 0) headers.set("vary", merged.join(", "));
}

/**
 * Applies a decision to response headers. Idempotent: values are set, never
 * appended, so running it in both the proxy and the Worker entry cannot
 * produce a duplicate Access-Control-Allow-Origin (which browsers reject).
 */
export function applyCorsHeaders(
  headers: Headers,
  decision: CorsDecision,
): void {
  if (decision.kind === "none") return;
  // The answer depends on who asks; shared caches must not reuse it across origins.
  mergeVary(headers, "Origin");
  if (decision.kind === "denied") return;
  headers.set("Access-Control-Allow-Origin", decision.origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set(
    "Access-Control-Expose-Headers",
    CORS_EXPOSED_RESPONSE_HEADERS.join(", "),
  );
}

/**
 * The answer to a preflight. An approved origin gets 204 with the policy; any
 * other origin (or an ineligible route) gets an empty 403 with no CORS headers
 * at all, which the browser reports as a blocked cross-origin request.
 */
export function corsPreflightResponse(decision: CorsDecision): Response {
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  mergeVary(
    headers,
    "Origin",
    "Access-Control-Request-Method",
    "Access-Control-Request-Headers",
  );
  if (decision.kind !== "allowed") {
    // No body: a browser reads only the status, and a bodiless answer is never
    // compressed, so a page that abandons the refused preflight (browsers do,
    // at the status line) cannot leave a half-written stream behind.
    return new Response(null, { status: 403, headers });
  }
  headers.set("Access-Control-Allow-Origin", decision.origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS.join(", "));
  headers.set(
    "Access-Control-Allow-Headers",
    CORS_ALLOWED_REQUEST_HEADERS.join(", "),
  );
  headers.set("Access-Control-Max-Age", String(CORS_PREFLIGHT_MAX_AGE_SECONDS));
  return new Response(null, { status: 204, headers });
}

/**
 * Returns `response` with the decision applied. For responses produced
 * outside the Next proxy (Worker gates and the fetch guard) so an approved
 * frontend can read an error instead of seeing an opaque network failure.
 * Responses that need no change are returned as they are; WebSocket upgrades
 * are never touched.
 */
export function withCors(response: Response, decision: CorsDecision): Response {
  if (decision.kind === "none") return response;
  if (
    response.status === 101 ||
    (response as { webSocket?: unknown }).webSocket
  )
    return response;
  const copy = new Response(response.body, response);
  applyCorsHeaders(copy.headers, decision);
  return copy;
}
