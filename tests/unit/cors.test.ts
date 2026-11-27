import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import proxy from "../../src/proxy";
import {
  CORS_ALLOWED_METHODS,
  CORS_ALLOWED_REQUEST_HEADERS,
  CORS_API_PREFIXES,
  DEVELOPMENT_ORIGINS,
  PRODUCTION_ORIGINS,
  allowedCorsOrigins,
  applyCorsHeaders,
  canonicalOrigin,
  corsDecision,
  corsPreflightResponse,
  isCorsApiPath,
  mergeVary,
  resetCorsWarningForTests,
  withCors,
  type CorsEnv,
} from "../../src/lib/cors";
import { isCrossSiteMutation } from "../../src/lib/csrf";
import { resetRateLimitState } from "../../src/lib/rate-limit";

const PROD: CorsEnv = { NODE_ENV: "production" };
const STAGING: CorsEnv = {
  NODE_ENV: "production",
  TRADECATCH_ENV: "staging",
  NEXT_PUBLIC_SITE_URL: "https://staging.tradecatch.ca",
};
const DEV: CorsEnv = { NODE_ENV: "development" };

const ENV_KEYS = [
  "NODE_ENV",
  "TRADECATCH_ENV",
  "NEXT_PUBLIC_SITE_URL",
  "CORS_ALLOWED_ORIGINS",
  "STAGING_BASIC_AUTH_USER",
  "STAGING_BASIC_AUTH_PASSWORD",
  "TRADECATCH_E2E",
  "NEXT_PUBLIC_TRADECATCH_ENV",
  "NEXT_PUBLIC_DEMO_MODE",
] as const;
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function setEnv(values: CorsEnv) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) (process.env as Record<string, string>)[key] = value;
  }
}

beforeEach(() => {
  setEnv({});
  resetRateLimitState();
  resetCorsWarningForTests();
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else (process.env as Record<string, string>)[key] = saved[key]!;
  }
  mock.restoreAll();
});

describe("origin matching is exact", () => {
  it("accepts only the canonical form a browser sends", () => {
    assert.equal(canonicalOrigin("https://tradecatch.ca"), "https://tradecatch.ca");
    assert.equal(canonicalOrigin("http://localhost:3100"), "http://localhost:3100");
  });

  it("rejects look-alikes, partial matches and malformed values", () => {
    for (const bad of [
      "https://tradecatch.ca/",
      "https://tradecatch.ca/path",
      "https://tradecatch.ca?x=1",
      "https://tradecatch.ca:443",
      "HTTPS://TRADECATCH.CA",
      "https://TradeCatch.ca",
      "https://tradecatch.ca@evil.example",
      "https://user:pass@tradecatch.ca",
      "https://tradecatch.ca ",
      "tradecatch.ca",
      "ftp://tradecatch.ca",
      "javascript:alert(1)",
      "null",
      "*",
      "https://*.tradecatch.ca",
      "",
    ]) {
      assert.equal(canonicalOrigin(bad), null, JSON.stringify(bad));
    }
    assert.equal(canonicalOrigin(null), null);
    assert.equal(canonicalOrigin(undefined), null);
  });

  it("a well-formed look-alike is a valid origin but is never on the list", () => {
    for (const lookalike of ["https://tradecatch.ca.evil.example", "https://eviltradecatch.ca", "https://tradecatch.ca.evil.example:443"]) {
      for (const env of [PROD, STAGING, DEV]) {
        assert.equal(allowedCorsOrigins(env).has(lookalike), false, lookalike);
      }
    }
  });
});

describe("allowed origins are separate per environment", () => {
  it("production: the two live origins, and never localhost or staging", () => {
    const origins = [...allowedCorsOrigins(PROD)].sort();
    assert.deepEqual(origins, [...PRODUCTION_ORIGINS].sort());
    assert.deepEqual(origins, ["https://tradecatch.ca", "https://www.tradecatch.ca"]);
    for (const origin of origins) {
      assert.equal(origin.includes("localhost"), false);
      assert.equal(origin.includes("staging"), false);
    }
  });

  it("staging: its own site and nothing from production or localhost", () => {
    const origins = [...allowedCorsOrigins(STAGING)];
    assert.deepEqual(origins, ["https://staging.tradecatch.ca"]);
  });

  it("staging with a plain-http or missing site URL allows nothing", () => {
    assert.equal(allowedCorsOrigins({ ...STAGING, NEXT_PUBLIC_SITE_URL: "http://staging.tradecatch.ca" }).size, 0);
    assert.equal(allowedCorsOrigins({ NODE_ENV: "production", TRADECATCH_ENV: "staging" }).size, 0);
  });

  it("development: local servers only, never the live origins", () => {
    const origins = [...allowedCorsOrigins(DEV)].sort();
    assert.deepEqual(origins, [...DEVELOPMENT_ORIGINS].sort());
    for (const live of PRODUCTION_ORIGINS) assert.equal(allowedCorsOrigins(DEV).has(live), false);
  });

  it("an unset environment is development, a production build is production", () => {
    assert.equal(allowedCorsOrigins({}).has("http://localhost:3001"), true);
    assert.equal(allowedCorsOrigins(PROD).has("http://localhost:3001"), false);
  });

  it("the local Playwright harness (a production build on localhost) is treated as development", () => {
    const harness: CorsEnv = {
      NODE_ENV: "production",
      TRADECATCH_E2E: "1",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3100",
    };
    assert.equal(allowedCorsOrigins(harness).has("http://localhost:3100"), true);
    // ...but the same flag on a real site URL does nothing.
    const spoof: CorsEnv = { NODE_ENV: "production", TRADECATCH_E2E: "1", NEXT_PUBLIC_SITE_URL: "https://tradecatch.ca" };
    assert.equal(allowedCorsOrigins(spoof).has("http://localhost:3100"), false);
    assert.equal(allowedCorsOrigins(spoof).has("https://tradecatch.ca"), true);
  });

  it("never contains a wildcard, in any environment", () => {
    for (const env of [PROD, STAGING, DEV, {}]) {
      for (const origin of allowedCorsOrigins(env)) assert.equal(origin.includes("*"), false);
    }
  });
});

describe("CORS_ALLOWED_ORIGINS extends the list safely", () => {
  it("adds exact https origins", () => {
    const origins = allowedCorsOrigins({ ...PROD, CORS_ALLOWED_ORIGINS: "https://app.tradecatch.ca, https://portal.tradecatch.ca" });
    assert.equal(origins.has("https://app.tradecatch.ca"), true);
    assert.equal(origins.has("https://portal.tradecatch.ca"), true);
    assert.equal(origins.has("https://tradecatch.ca"), true);
  });

  it("drops wildcards, paths, trailing slashes, null and bare hosts instead of widening the list", () => {
    const warn = mock.method(console, "warn", () => {});
    const origins = allowedCorsOrigins({
      ...PROD,
      CORS_ALLOWED_ORIGINS: "*,https://*.tradecatch.ca,https://app.tradecatch.ca/,https://app.tradecatch.ca/x,null,app.tradecatch.ca,https://ok.tradecatch.ca",
    });
    assert.deepEqual([...origins].sort(), ["https://ok.tradecatch.ca", ...PRODUCTION_ORIGINS].sort());
    assert.equal(warn.mock.callCount(), 1, "one log line, not one per request");
    assert.match(String(warn.mock.calls[0]!.arguments[0]), /invalid_origins_ignored/);
  });

  it("refuses plain http in production and staging, even for localhost", () => {
    mock.method(console, "warn", () => {});
    for (const base of [PROD, STAGING]) {
      const origins = allowedCorsOrigins({ ...base, CORS_ALLOWED_ORIGINS: "http://tradecatch.ca,http://localhost:3000,http://127.0.0.1:3000" });
      assert.equal(origins.has("http://tradecatch.ca"), false);
      assert.equal(origins.has("http://localhost:3000"), false);
      assert.equal(origins.has("http://127.0.0.1:3000"), false);
    }
  });

  it("allows an http localhost origin in development only", () => {
    assert.equal(allowedCorsOrigins({ ...DEV, CORS_ALLOWED_ORIGINS: "http://localhost:4000" }).has("http://localhost:4000"), true);
    mock.method(console, "warn", () => {});
    assert.equal(allowedCorsOrigins({ ...DEV, CORS_ALLOWED_ORIGINS: "http://evil.example" }).has("http://evil.example"), false);
  });
});

describe("which routes are offered cross-origin", () => {
  it("offers the browser-facing groups the frontend actually calls", () => {
    for (const path of [
      "/api/auth/password-login",
      "/api/auth/forgot-password",
      "/api/auth/logout",
      "/api/app/me",
      "/api/app/overview",
      "/api/app/sms-receptionist",
      "/api/businesses/org_1/appointments",
      "/api/businesses/org_1",
      "/api/billing/checkout",
      "/api/billing/portal",
      "/api/admin/businesses",
      "/api/help/articles",
      "/api/referrals/submit",
      "/api/book-audit",
      "/api/website-requests",
      "/api/receptionist/demo",
      "/api/receptionist/demo/voice",
      "/api/client-error",
    ]) {
      assert.equal(isCorsApiPath(path), true, path);
    }
  });

  it("never offers machine-to-machine routes, cron ticks, ops or the API-key lead endpoint", () => {
    for (const path of [
      "/api/webhooks/stripe",
      "/api/webhooks/twilio/sms",
      "/api/twilio/voice",
      "/api/voice/socket",
      "/api/receptionist/agent/tools",
      "/api/receptionist/agent-config",
      "/api/receptionist/ops/profile",
      "/api/receptionist/tick",
      "/api/ops/demo/reset",
      "/api/missed-call/ops/provision-organization",
      "/api/missed-call/escalations/tick",
      "/api/monitoring/tick",
      "/api/monitoring/watch",
      "/api/monitoring/ingest",
      "/api/gmail/sync/tick",
      "/api/book-audit/notifications/tick",
      "/api/app/tick",
      "/api/website-leads",
      "/api/installations/verify",
      "/api/health",
      "/api/scheduling/reconcile",
    ]) {
      assert.equal(isCorsApiPath(path), false, path);
    }
  });

  it("does not match by loose prefix", () => {
    assert.equal(isCorsApiPath("/api/application"), false);
    assert.equal(isCorsApiPath("/api/authentication"), false);
    assert.equal(isCorsApiPath("/api/book-auditor"), false);
    assert.equal(isCorsApiPath("/api/businesses"), false);
    assert.equal(isCorsApiPath("/app/me"), false);
    assert.equal(isCorsApiPath("/login"), false);
  });

  it("lists every group explicitly, with no wildcard", () => {
    for (const prefix of CORS_API_PREFIXES) {
      assert.match(prefix, /^\/api\/[a-z-]+(\/[a-z-]*)*$/);
    }
  });
});

function decide(input: {
  origin?: string;
  method?: string;
  path?: string;
  env?: CorsEnv;
  host?: string;
  extra?: Record<string, string>;
}) {
  const headers = new Headers(input.extra);
  if (input.origin !== undefined) headers.set("origin", input.origin);
  return corsDecision({
    method: input.method ?? "GET",
    pathname: input.path ?? "/api/app/me",
    headers,
    selfHosts: [input.host ?? "tradecatch.ca"],
    env: input.env ?? PROD,
  });
}

describe("cross-origin decisions", () => {
  it("does nothing without an Origin header (same-site navigation, curl, webhooks)", () => {
    assert.deepEqual(decide({}), { kind: "none" });
  });

  it("does nothing for same-origin requests, which browsers also label with Origin", () => {
    assert.deepEqual(decide({ origin: "https://tradecatch.ca", method: "POST" }), { kind: "none" });
  });

  it("does nothing outside /api", () => {
    assert.deepEqual(decide({ origin: "https://evil.example", path: "/login" }), { kind: "none" });
  });

  it("approves the live origins in production", () => {
    for (const origin of PRODUCTION_ORIGINS) {
      const verdict = decide({ origin, host: origin === "https://tradecatch.ca" ? "api.tradecatch.ca" : "tradecatch.ca" });
      assert.deepEqual(verdict, { kind: "allowed", origin, preflight: false });
    }
  });

  it("denies everything else, including look-alikes and the other environments' origins", () => {
    for (const origin of [
      "https://evil.example",
      "https://tradecatch.ca.evil.example",
      "https://eviltradecatch.ca",
      "http://tradecatch.ca",
      "https://tradecatch.ca:8443",
      "https://staging.tradecatch.ca",
      "http://localhost:3000",
      "http://127.0.0.1:3100",
      "null",
      "not a url",
    ]) {
      assert.equal(decide({ origin, host: "api.tradecatch.ca" }).kind, "denied", origin);
    }
  });

  it("denies an approved origin on a route that is never offered", () => {
    const verdict = decide({ origin: "https://www.tradecatch.ca", path: "/api/webhooks/stripe" });
    assert.deepEqual(verdict, { kind: "denied", preflight: false });
  });

  it("recognises a preflight only when it asks for a method", () => {
    const real = decide({ origin: "https://www.tradecatch.ca", method: "OPTIONS", extra: { "access-control-request-method": "POST" } });
    assert.deepEqual(real, { kind: "allowed", origin: "https://www.tradecatch.ca", preflight: true });
    const plain = decide({ origin: "https://www.tradecatch.ca", method: "OPTIONS" });
    assert.deepEqual(plain, { kind: "allowed", origin: "https://www.tradecatch.ca", preflight: false });
  });

  it("staging approves staging and refuses production", () => {
    const env = { ...STAGING, CORS_ALLOWED_ORIGINS: "https://app.staging.tradecatch.ca" };
    assert.equal(decide({ origin: "https://app.staging.tradecatch.ca", env, host: "staging.tradecatch.ca" }).kind, "allowed");
    assert.equal(decide({ origin: "https://tradecatch.ca", env, host: "staging.tradecatch.ca" }).kind, "denied");
    assert.equal(decide({ origin: "https://www.tradecatch.ca", env, host: "staging.tradecatch.ca" }).kind, "denied");
  });

  it("development approves local servers and refuses the live origins", () => {
    assert.equal(decide({ origin: "http://localhost:3001", env: DEV, host: "localhost:3100" }).kind, "allowed");
    assert.equal(decide({ origin: "https://tradecatch.ca", env: DEV, host: "localhost:3100" }).kind, "denied");
  });
});

describe("headers", () => {
  const allowed = { kind: "allowed", origin: "https://www.tradecatch.ca", preflight: true } as const;

  it("answers an approved preflight with the full policy, for one origin", async () => {
    const res = corsPreflightResponse(allowed);
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "https://www.tradecatch.ca");
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");
    const methods = res.headers.get("access-control-allow-methods")!.split(", ");
    assert.deepEqual(methods, [...CORS_ALLOWED_METHODS] as string[]);
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) assert.ok(methods.includes(method), method);
    const headers = res.headers.get("access-control-allow-headers")!.toLowerCase().split(", ");
    assert.deepEqual(headers, CORS_ALLOWED_REQUEST_HEADERS.map((h) => h.toLowerCase()));
    assert.ok(headers.includes("authorization") && headers.includes("content-type"));
    assert.equal(res.headers.get("access-control-max-age"), "600");
    assert.match(res.headers.get("vary")!, /Origin/);
    assert.match(res.headers.get("vary")!, /Access-Control-Request-Method/);
    assert.match(res.headers.get("vary")!, /Access-Control-Request-Headers/);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(await res.text(), "");
  });

  it("never combines a wildcard with credentials", () => {
    for (const verdict of [allowed, { kind: "allowed", origin: "https://tradecatch.ca", preflight: false } as const]) {
      const headers = new Headers();
      applyCorsHeaders(headers, verdict);
      assert.notEqual(headers.get("access-control-allow-origin"), "*");
      assert.equal(headers.get("access-control-allow-credentials"), "true");
    }
    const pre = corsPreflightResponse(allowed);
    assert.notEqual(pre.headers.get("access-control-allow-origin"), "*");
    assert.equal(pre.headers.get("access-control-allow-headers")!.includes("*"), false);
  });

  it("refuses an unapproved preflight with 403 and no CORS headers at all", async () => {
    const res = corsPreflightResponse({ kind: "denied", preflight: true });
    assert.equal(res.status, 403);
    for (const name of [
      "access-control-allow-origin",
      "access-control-allow-credentials",
      "access-control-allow-methods",
      "access-control-allow-headers",
      "access-control-max-age",
    ]) {
      assert.equal(res.headers.get(name), null, name);
    }
    assert.match(res.headers.get("vary")!, /Origin/);
    assert.equal(await res.text(), "");
    assert.equal(res.headers.get("content-type"), null);
  });

  it("marks the answer as origin-dependent for approved and refused origins alike", () => {
    for (const verdict of [{ kind: "allowed", origin: "https://tradecatch.ca", preflight: false } as const, { kind: "denied", preflight: false } as const]) {
      const headers = new Headers();
      applyCorsHeaders(headers, verdict);
      assert.match(headers.get("vary")!, /Origin/);
    }
    const none = new Headers();
    applyCorsHeaders(none, { kind: "none" });
    assert.equal(none.get("vary"), null);
  });

  it("gives a refused origin only Vary, never Allow-Origin", () => {
    const headers = new Headers();
    applyCorsHeaders(headers, { kind: "denied", preflight: false });
    assert.equal(headers.get("access-control-allow-origin"), null);
    assert.equal(headers.get("access-control-allow-credentials"), null);
  });

  it("exposes the rate-limit hints so a frontend can read a 429", () => {
    const headers = new Headers();
    applyCorsHeaders(headers, { kind: "allowed", origin: "https://tradecatch.ca", preflight: false });
    const exposed = headers.get("access-control-expose-headers")!.toLowerCase();
    for (const name of ["retry-after", "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset"]) assert.ok(exposed.includes(name), name);
  });

  it("is idempotent: applying twice leaves exactly one value of each header", () => {
    const headers = new Headers({ vary: "Accept-Encoding" });
    const verdict = { kind: "allowed", origin: "https://www.tradecatch.ca", preflight: false } as const;
    applyCorsHeaders(headers, verdict);
    applyCorsHeaders(headers, verdict);
    assert.equal(headers.get("access-control-allow-origin"), "https://www.tradecatch.ca");
    assert.equal(headers.get("vary"), "Accept-Encoding, Origin");
  });

  it("mergeVary keeps existing tokens, ignores case duplicates and leaves Vary: * alone", () => {
    const a = new Headers({ vary: "accept-encoding, origin" });
    mergeVary(a, "Origin", "Cookie");
    assert.equal(a.get("vary"), "accept-encoding, origin, Cookie");
    const star = new Headers({ vary: "*" });
    mergeVary(star, "Origin");
    assert.equal(star.get("vary"), "*");
  });

  it("withCors leaves unrelated and upgrade responses alone, and adds headers to approved errors", async () => {
    const plain = new Response("ok");
    assert.equal(withCors(plain, { kind: "none" }), plain);
    const upgrade = { status: 101, headers: new Headers(), body: null, webSocket: {} } as unknown as Response;
    assert.equal(withCors(upgrade, { kind: "allowed", origin: "https://tradecatch.ca", preflight: false }), upgrade);
    const verdict = { kind: "allowed", origin: "https://tradecatch.ca", preflight: false } as const;
    const gate = Response.json({ error: "Installation or domain is not approved." }, { status: 403 });
    const out = withCors(gate, verdict);
    // Running the Worker layer over the proxy's answer must not double the header.
    const twice = withCors(out, verdict);
    assert.equal(twice.headers.get("access-control-allow-origin"), "https://tradecatch.ca");
    assert.equal(twice.status, 403);
    assert.deepEqual(await twice.json(), { error: "Installation or domain is not approved." });
  });
});

describe("the CSRF guard and an approved origin", () => {
  const hosts = ["tradecatch.ca"];
  const cookie = "tc_session=abc.def";
  const guard = (headers: Record<string, string>, trustedOrigin?: string | null) =>
    isCrossSiteMutation({ method: "POST", headers: new Headers({ cookie, ...headers }), hosts, trustedOrigin });

  it("lets the approved origin make a cookie-authenticated write", () => {
    assert.equal(guard({ origin: "https://www.tradecatch.ca", "sec-fetch-site": "same-site" }, "https://www.tradecatch.ca"), false);
  });

  it("still blocks the same write without the approval, and any other origin", () => {
    assert.equal(guard({ origin: "https://www.tradecatch.ca", "sec-fetch-site": "same-site" }), true);
    assert.equal(guard({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }, "https://www.tradecatch.ca"), true);
    assert.equal(guard({ origin: "https://blog.tradecatch.ca", "sec-fetch-site": "same-site" }, "https://www.tradecatch.ca"), true);
    assert.equal(guard({ origin: "null", "sec-fetch-site": "cross-site" }, "https://www.tradecatch.ca"), true);
  });

  it("does not trust a missing Origin header to match", () => {
    assert.equal(guard({ "sec-fetch-site": "cross-site" }, "https://www.tradecatch.ca"), true);
  });
});

describe("CORS in the proxy", () => {
  const FRONTEND = "https://www.tradecatch.ca";
  const call = (method: string, headers: Record<string, string>, path = "/api/app/me", host = "tradecatch.ca") =>
    proxy(new NextRequest(`https://${host}${path}`, { method, headers }));

  const preflight = (origin: string, requestMethod: string, requestHeaders: string, path = "/api/app/me") =>
    call("OPTIONS", { origin, "access-control-request-method": requestMethod, "access-control-request-headers": requestHeaders }, path);

  beforeEach(() => setEnv(PROD));

  it("answers an approved preflight for every method the app uses, with no authentication", async () => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const res = await preflight(FRONTEND, method, "content-type, authorization");
      assert.equal(res.status, 204, method);
      assert.equal(res.headers.get("access-control-allow-origin"), FRONTEND, method);
      assert.equal(res.headers.get("access-control-allow-credentials"), "true", method);
      assert.ok(res.headers.get("access-control-allow-methods")!.includes(method), method);
      assert.equal(res.headers.get("x-middleware-next"), null, "answered here, never reaches a route that wants a session");
    }
  });

  it("covers login, dashboard, appointments, SMS and payment routes", async () => {
    for (const path of [
      "/api/auth/password-login",
      "/api/auth/magic-link",
      "/api/app/overview",
      "/api/businesses/org_1/appointments",
      "/api/businesses/org_1/calls",
      "/api/app/sms-receptionist",
      "/api/billing/checkout",
      "/api/billing/portal",
    ]) {
      const res = await preflight(FRONTEND, "POST", "content-type", path);
      assert.equal(res.status, 204, path);
      assert.equal(res.headers.get("access-control-allow-origin"), FRONTEND, path);
    }
  });

  it("answers an approved preflight even when the staging gate would demand Basic auth", async () => {
    setEnv({
      NODE_ENV: "production",
      TRADECATCH_ENV: "staging",
      NEXT_PUBLIC_SITE_URL: "https://staging.tradecatch.ca",
      CORS_ALLOWED_ORIGINS: "https://app.staging.tradecatch.ca",
      STAGING_BASIC_AUTH_USER: "qa",
      STAGING_BASIC_AUTH_PASSWORD: "secret",
    });
    const pre = await call(
      "OPTIONS",
      { origin: "https://app.staging.tradecatch.ca", "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
      "/api/app/me",
      "staging.tradecatch.ca",
    );
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), "https://app.staging.tradecatch.ca");
    // The real request is still behind the gate.
    const real = await call("GET", { origin: "https://app.staging.tradecatch.ca" }, "/api/app/me", "staging.tradecatch.ca");
    assert.equal(real.status, 401);
    assert.equal(real.headers.get("access-control-allow-origin"), null);
  });

  it("refuses a preflight from an unapproved origin with 403 and no CORS headers", async () => {
    // (An http:// Origin naming this same host counts as same-origin, as in the CSRF guard; the browser still gets no CORS headers.)
    for (const origin of ["https://evil.example", "https://tradecatch.ca.evil.example", "https://eviltradecatch.ca", "https://tradecatch.ca:8443", "null", "http://localhost:3000"]) {
      const res = await preflight(origin, "POST", "content-type");
      assert.equal(res.status, 403, origin);
      assert.equal(res.headers.get("access-control-allow-origin"), null, origin);
      assert.equal(res.headers.get("access-control-allow-credentials"), null, origin);
      assert.equal(res.headers.get("access-control-allow-methods"), null, origin);
    }
  });

  it("refuses an approved origin's preflight on a machine-only route", async () => {
    for (const path of ["/api/webhooks/stripe", "/api/twilio/sms", "/api/website-leads", "/api/ops/demo/reset", "/api/missed-call/escalations/tick"]) {
      const res = await preflight(FRONTEND, "POST", "content-type", path);
      assert.equal(res.status, 403, path);
      assert.equal(res.headers.get("access-control-allow-origin"), null, path);
    }
  });

  it("a preflight does not ask for headers beyond the approved list", async () => {
    const res = await preflight(FRONTEND, "POST", "content-type, x-tradecatch-key, x-ops-actor");
    const allowed = res.headers.get("access-control-allow-headers")!.toLowerCase();
    assert.equal(allowed.includes("x-tradecatch-key"), false);
    assert.equal(allowed.includes("x-ops-actor"), false);
  });

  it("adds the policy to a normal response from an approved origin, once", async () => {
    const res = await call("GET", { origin: FRONTEND, cookie: "tc_session=abc.def" });
    assert.equal(res.headers.get("x-middleware-next"), "1");
    assert.equal(res.headers.get("access-control-allow-origin"), FRONTEND);
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");
    assert.match(res.headers.get("vary")!, /Origin/);
  });

  it("adds nothing to a response for an unapproved origin, but still marks it origin-dependent", async () => {
    const res = await call("GET", { origin: "https://evil.example" });
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(res.headers.get("access-control-allow-credentials"), null);
    assert.match(res.headers.get("vary")!, /Origin/);
  });

  it("adds nothing for same-origin calls, which is how the app itself talks to its API", async () => {
    const res = await call("POST", { origin: "https://tradecatch.ca", "sec-fetch-site": "same-origin", cookie: "tc_session=abc.def" });
    assert.equal(res.headers.get("x-middleware-next"), "1");
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(res.headers.get("vary"), null);
  });

  it("adds nothing to a machine-only route, even for an approved origin", async () => {
    for (const path of ["/api/webhooks/stripe", "/api/website-leads", "/api/gmail/sync/tick"]) {
      const res = await call("POST", { origin: FRONTEND, authorization: "Bearer secret" }, path);
      assert.equal(res.headers.get("access-control-allow-origin"), null, path);
    }
  });

  it("lets the approved origin make a cookie-authenticated write, and still stops everyone else", async () => {
    const mine = await call("POST", { origin: FRONTEND, "sec-fetch-site": "same-site", cookie: "tc_session=abc.def" }, "/api/app/api-keys");
    assert.equal(mine.headers.get("x-middleware-next"), "1");
    assert.equal(mine.headers.get("access-control-allow-origin"), FRONTEND);
    for (const headers of [
      { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      { origin: "https://blog.tradecatch.ca", "sec-fetch-site": "same-site" },
      { origin: "null", "sec-fetch-site": "cross-site" },
    ]) {
      const res = await call("POST", { ...headers, cookie: "tc_session=abc.def" }, "/api/app/api-keys");
      assert.equal(res.status, 403, JSON.stringify(headers));
      assert.deepEqual(await res.json(), { error: "Cross-site request blocked." });
      assert.equal(res.headers.get("access-control-allow-origin"), null);
    }
  });

  it("lets an approved frontend read the errors the proxy itself returns (413 and 429)", async () => {
    const big = await call("POST", { origin: FRONTEND, "content-length": String(3 * 1024 * 1024) }, "/api/app/api-keys");
    assert.equal(big.status, 413);
    assert.equal(big.headers.get("access-control-allow-origin"), FRONTEND);

    setEnv({ NODE_ENV: "development" });
    resetRateLimitState();
    let limited: Response | undefined;
    for (let i = 0; i < 80 && !limited; i += 1) {
      const res = await call("POST", { origin: "http://localhost:3001", "x-forwarded-for": "198.51.100.77" }, "/api/app/api-keys", "localhost:3100");
      if (res.status === 429) limited = res;
    }
    assert.ok(limited, "the central limiter eventually refuses");
    assert.equal(limited.headers.get("access-control-allow-origin"), "http://localhost:3001");
    assert.match(limited.headers.get("access-control-expose-headers")!, /Retry-After/);
  });

  it("allows localhost only in development", async () => {
    setEnv({ NODE_ENV: "development" });
    const dev = await call("GET", { origin: "http://localhost:3001" }, "/api/app/me", "localhost:3100");
    assert.equal(dev.headers.get("access-control-allow-origin"), "http://localhost:3001");
    setEnv(PROD);
    const prod = await call("GET", { origin: "http://localhost:3001" });
    assert.equal(prod.headers.get("access-control-allow-origin"), null);
  });

  it("leaves non-API pages untouched", async () => {
    const res = await proxy(new NextRequest("https://tradecatch.ca/health", { headers: { origin: "https://evil.example" } }));
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(res.headers.get("x-middleware-next"), "1");
  });
});
