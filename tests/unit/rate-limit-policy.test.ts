import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  clientIpKey,
  getClientIp,
  isCloudflareWorker,
  resetRateLimitState,
} from "../../src/lib/rate-limit";
import {
  enforceCentralLimit,
  rateLimitMode,
  resetRateLimitLogThrottle,
} from "../../src/lib/rate-limit-central";
import {
  EXEMPT_API_PREFIXES,
  POLICIES,
  classifyApiRequest,
  consumePolicy,
  describeRefill,
  type PolicyId,
} from "../../src/lib/rate-limit-policy";
import { enforcePolicy, tooManyRequests } from "../../src/lib/rate-limit-response";
import { PG_SLACK_MS } from "../../src/lib/pg-rate-limit";
import { assertValidSpec } from "../../src/lib/token-bucket";

const root = join(import.meta.dirname, "..", "..");
const apiRoot = join(root, "src", "app", "api");

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}
const apiPath = (file: string) =>
  `/api/${relative(apiRoot, file).split(sep).slice(0, -1).join("/")}`;

// A frozen clock: a bucket refills as real time passes, so a test that fires
// hundreds of requests must not have the refill change its count on a slow or
// busy machine. Tests that need time to pass move `clock` themselves.
let clock = 1_700_000_000_000;
beforeEach(() => {
  clock = 1_700_000_000_000;
  mock.method(Date, "now", () => clock);
  resetRateLimitState();
  resetRateLimitLogThrottle();
});
afterEach(() => {
  mock.restoreAll();
});

const request = (method: string, path: string, ip = "203.0.113.7") =>
  new Request(`https://tradecatch.test${path}`, {
    method,
    headers: { "x-forwarded-for": ip },
  });
// No NODE_ENV: development rules, so the forwarded address is believed.
const env = {};

describe("policy table", () => {
  it("only holds buckets that can work", () => {
    for (const [id, policy] of Object.entries(POLICIES)) {
      assertValidSpec(policy);
      // The Postgres bucket hands a token out up to PG_SLACK_MS early (see
      // pg-rate-limit.ts). That is only harmless while a refill interval is far
      // longer than that, so a policy faster than this needs the slack revisited.
      assert.ok(
        policy.refillEveryMs >= 10 * PG_SLACK_MS,
        `${id} refills every ${policy.refillEveryMs} ms, too fast for the ${PG_SLACK_MS} ms Postgres slack`,
      );
      if ("unknown" in policy && policy.unknown) {
        assert.ok(policy.unknown.refillEveryMs >= 10 * PG_SLACK_MS, `${id} (unknown address) refills too fast`);
      }
      if ("unknown" in policy && policy.unknown) assertValidSpec(policy.unknown);
      assert.ok(policy.why.length >= 8, `${id} says what it protects`);
    }
  });

  it("makes sign-in, payments, sensitive and admin routes no looser than the API default", () => {
    // Sustained rate = 1 / refillEveryMs. `sms.sender` is a backstop against
    // runaway loops across many recipients, deliberately wider than one
    // person's budget; the per-recipient SMS limits are the strict ones.
    const write = POLICIES["api.write"];
    for (const [id, policy] of Object.entries(POLICIES)) {
      if (!["auth", "payments", "sensitive", "admin", "sms"].includes(policy.group)) continue;
      if (id === "sms.sender") continue;
      assert.ok(policy.capacity <= write.capacity, `${id} burst`);
      assert.ok(policy.refillEveryMs >= write.refillEveryMs, `${id} sustained rate`);
    }
    // Sign-in is looser only for the shared unknown address.
    assert.ok(POLICIES["auth.magic-link"].capacity <= 5);
    assert.ok(POLICIES["payments.checkout"].capacity <= 5);
    assert.ok(POLICIES["sensitive.account-export"].capacity <= 3);
  });

  it("is documented: docs/RATE_LIMITS.md states each policy's burst, refill and scope as the code has them", () => {
    const doc = readFileSync(join(root, "docs", "RATE_LIMITS.md"), "utf8");
    const stale = Object.entries(POLICIES)
      .map(([id, p]) => `| \`${id}\` | ${p.capacity} | ${describeRefill(p.refillEveryMs)} | ${p.per} |`)
      .filter((row) => !doc.includes(row));
    assert.deepEqual(stale, [], "update these rows in docs/RATE_LIMITS.md");
  });

  it("is the only place limits are written: routes and product code ask for a policy by name", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(root, "src"))) {
      const rel = relative(root, file).split(sep).join("/");
      if (rel.startsWith("src/lib/")) continue;
      const text = readFileSync(file, "utf8");
      if (/\b(?:rateLimitAsync|enforceRateLimit|takeToken|rateLimit)\(\{/.test(text)) offenders.push(rel);
    }
    assert.deepEqual(offenders, [], "add the limit to src/lib/rate-limit-policy.ts and use enforcePolicy/consumePolicy");
  });

  it("every named policy is used by some route or product code (no dead limits)", () => {
    const used = new Set<string>();
    for (const file of sourceFiles(join(root, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const id of Object.keys(POLICIES)) if (text.includes(`"${id}"`)) used.add(id);
    }
    const centralOnly = ["api.read", "api.write"]; // chosen by classifyApiRequest
    const dead = Object.keys(POLICIES).filter((id) => !used.has(id) && !centralOnly.includes(id));
    assert.deepEqual(dead, []);
  });
});

describe("which routes the default limit covers", () => {
  it("limits every API route by method unless it is on the exempt list", () => {
    assert.deepEqual(classifyApiRequest("GET", "/api/app/leads"), { kind: "limited", policy: "api.read" });
    assert.deepEqual(classifyApiRequest("HEAD", "/api/app/leads"), { kind: "limited", policy: "api.read" });
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.deepEqual(classifyApiRequest(method, "/api/app/leads"), { kind: "limited", policy: "api.write" });
    }
    assert.equal(classifyApiRequest("OPTIONS", "/api/app/leads").kind, "exempt");
  });

  it("exempts provider webhooks, the voice agent and probes, and nothing that merely looks like them", () => {
    for (const path of [
      "/api/twilio/voice/inbound",
      "/api/twilio/sms/status",
      "/api/webhooks/stripe",
      "/api/webhooks/twilio/voice",
      "/api/voice/socket",
      "/api/receptionist/agent/book",
      "/api/receptionist/agent-config",
      "/api/health",
    ]) {
      assert.equal(classifyApiRequest("POST", path).kind, "exempt", path);
    }
    for (const path of [
      "/api/twilio-fake",
      "/api/webhooks-fake/x",
      "/api/healthcheck",
      "/api/receptionist/agents",
      "/api/receptionist/demo",
      "/api/receptionist/calls",
      "/api/app/voice/socket",
    ]) {
      assert.equal(classifyApiRequest("POST", path).kind, "limited", path);
    }
  });

  it("has no stale exemptions: each prefix matches a real route", () => {
    const paths = routeFiles(apiRoot).map(apiPath);
    for (const { prefix } of EXEMPT_API_PREFIXES) {
      const base = prefix.replace(/\/$/, "");
      assert.ok(
        paths.some((p) => p === base || p.startsWith(`${base}/`)),
        `${prefix} matches no route`,
      );
    }
  });

  it("exempts only routes that prove who is calling", () => {
    // An exempt route has no address limit, so it must not be open to anyone.
    // Each file (or the module it hands the request to) must verify a provider
    // signature or a shared secret. /api/health is public on purpose.
    const proofs = [
      "assertTwilioWebhook",
      "verifyStripeSignature",
      "authorizeGmailPush",
      "authorizeOpsRequest",
      "handleAgentRequest",
      "safeEqual",
      "/api/twilio/",
    ];
    const publicByDesign = new Set(["/api/health"]);
    const unproven: string[] = [];
    for (const file of routeFiles(apiRoot)) {
      const path = apiPath(file);
      if (classifyApiRequest("POST", path).kind !== "exempt" || publicByDesign.has(path)) continue;
      const text = readFileSync(file, "utf8");
      if (!proofs.some((proof) => text.includes(proof))) unproven.push(path);
    }
    assert.deepEqual(unproven, []);
  });
});

describe("default limit in front of every API route", () => {
  it("lets a normal burst through and refuses the rest with a Retry-After", async () => {
    const results: Array<Response | null> = [];
    for (let i = 0; i < 70; i += 1) results.push(await enforceCentralLimit(request("POST", "/api/app/leads"), env));
    assert.equal(results.filter((r) => r === null).length, 60, "api.write allows a burst of 60");
    const refused = results.find((r) => r !== null)!;
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get("retry-after"), "1");
    assert.equal(refused.headers.get("ratelimit-limit"), "60");
    assert.equal(refused.headers.get("ratelimit-remaining"), "0");
    assert.match(refused.headers.get("cache-control") ?? "", /no-store/);
    assert.match(refused.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await refused.json(), {
      error: "Too many requests. Please wait a moment and try again.",
      code: "rate_limited",
      retryAfterSeconds: 1,
    });
  });

  it("limits each client address on its own", async () => {
    for (let i = 0; i < 70; i += 1) await enforceCentralLimit(request("POST", "/api/app/leads", "203.0.113.1"), env);
    assert.equal((await enforceCentralLimit(request("POST", "/api/app/leads", "203.0.113.1"), env))?.status, 429);
    assert.equal(await enforceCentralLimit(request("POST", "/api/app/leads", "203.0.113.2"), env), null);
  });

  it("gives reads and writes separate budgets", async () => {
    let refusedReads = 0;
    for (let i = 0; i < 300; i += 1) {
      if (await enforceCentralLimit(request("GET", "/api/app/overview"), env)) refusedReads += 1;
    }
    assert.equal(refusedReads, 60, "240 of 300 rapid GETs allowed");
    assert.equal(await enforceCentralLimit(request("POST", "/api/app/leads"), env), null, "a write is still fine");
  });

  it("treats every address in an IPv6 /64 as one client", async () => {
    const results = [];
    for (let i = 0; i < 70; i += 1) {
      const address = `2001:db8:abcd:12:${i.toString(16)}:${(i * 7).toString(16)}::1`;
      results.push(await enforceCentralLimit(request("POST", "/api/app/leads", address), env));
    }
    assert.equal(results.filter((r) => r === null).length, 60);
  });

  it("recovers: a refused client may send again once tokens come back", async () => {
    for (let i = 0; i < 60; i += 1) await enforceCentralLimit(request("POST", "/api/app/leads"), env);
    assert.equal((await enforceCentralLimit(request("POST", "/api/app/leads"), env))?.status, 429);
    clock += 3_000; // api.write refills one token a second
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await enforceCentralLimit(request("POST", "/api/app/leads"), env));
    assert.deepEqual(results.map((r) => r === null), [true, true, true, false, false]);
  });

  it("does not attempt Postgres from the proxy on Cloudflare (its bundle cannot connect there), but does elsewhere", async () => {
    // Nothing listens on port 1, so any Postgres attempt fails at once and is logged.
    const durable = { DATABASE_URL: "postgresql://postgres:x@127.0.0.1:1/none", MISSED_CALL_DURABLE_STORE: "1" };
    const errors: string[] = [];
    mock.method(console, "error", (line: string) => errors.push(String(line)));

    // A server or Node host: Postgres is the shared store, so it is tried (and falls back, once logged).
    for (let i = 0; i < 3; i += 1) await enforceCentralLimit(request("POST", "/api/app/leads"), durable);
    assert.equal(errors.filter((e) => e.includes("Postgres failed")).length, 1, "tried, failed, logged once");

    // A Cloudflare Worker: never attempted, so nothing to fail or log, and the limit still holds from memory.
    resetRateLimitState();
    errors.length = 0;
    Object.defineProperty(globalThis.navigator, "userAgent", { value: "Cloudflare-Workers", configurable: true });
    try {
      const results = [];
      for (let i = 0; i < 70; i += 1) results.push(await enforceCentralLimit(request("POST", "/api/app/leads"), durable));
      assert.deepEqual(errors, [], "no failed attempts");
      assert.equal(results.filter((r) => r === null).length, 60, "api.write still allows 60 and refuses the rest");
    } finally {
      Reflect.deleteProperty(globalThis.navigator, "userAgent");
    }
  });

  it("never limits voice, provider webhooks or probes, however hard they are hit", async () => {
    for (const path of [
      "/api/twilio/voice/inbound",
      "/api/webhooks/stripe",
      "/api/receptionist/agent/availability",
      "/api/voice/socket",
      "/api/health",
    ]) {
      for (let i = 0; i < 500; i += 1) {
        assert.equal(await enforceCentralLimit(request("POST", path), env), null, `${path} #${i}`);
      }
    }
  });

  it("does not limit clients it cannot tell apart, since they would all share one bucket", async () => {
    const production = { NODE_ENV: "production" };
    const anonymous = () => new Request("https://tradecatch.test/api/app/leads", { method: "POST" });
    assert.equal(getClientIp(anonymous(), production), "unknown");
    for (let i = 0; i < 300; i += 1) assert.equal(await enforceCentralLimit(anonymous(), production), null);
  });

  it("monitor mode logs what it would refuse and lets everything through; off switches the layer off", async () => {
    const lines: string[] = [];
    mock.method(console, "warn", (line: string) => lines.push(line));
    for (let i = 0; i < 70; i += 1) {
      assert.equal(await enforceCentralLimit(request("POST", "/api/app/leads"), { RATE_LIMIT_MODE: "monitor" }), null);
    }
    assert.equal(lines.length, 1, "ten refusals, one line");
    assert.deepEqual(
      { ...JSON.parse(lines[0]), retryAfterMs: undefined },
      {
        event: "tradecatch.rate_limit.limited",
        policy: "api.write",
        mode: "monitor",
        method: "POST",
        path: "/api/app/leads",
        tier: "memory",
        retryAfterMs: undefined,
        suppressed: 0,
      },
    );
    assert.doesNotMatch(lines[0], /203\.0\.113/, "the client address is not logged");

    resetRateLimitState();
    resetRateLimitLogThrottle();
    for (let i = 0; i < 70; i += 1) {
      assert.equal(await enforceCentralLimit(request("POST", "/api/app/leads"), { RATE_LIMIT_MODE: "off" }), null);
    }
    assert.equal(lines.length, 1, "off logs nothing");
    assert.equal(rateLimitMode({}), "enforce");
    assert.equal(rateLimitMode({ RATE_LIMIT_MODE: "nonsense" }), "enforce", "a typo does not switch protection off");
    assert.equal(rateLimitMode({ RATE_LIMIT_MODE: " Monitor " }), "monitor");
  });

  it("logs a flood as one line per 10 seconds that says how many refusals it stands for", async () => {
    const lines: string[] = [];
    mock.method(console, "warn", (line: string) => lines.push(line));
    for (let i = 0; i < 1_060; i += 1) await enforceCentralLimit(request("POST", "/api/app/leads"), env);
    assert.equal(lines.length, 1, "1,000 refusals, one line");
    clock += 10_000;
    for (let i = 0; i < 30; i += 1) await enforceCentralLimit(request("POST", "/api/app/leads"), env);
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[1]).suppressed, 999, "the first line was 1 of 1,000 refusals; the next says 999 were skipped");
  });
});

describe("named policies", () => {
  it("enforces a strict policy per user, not per address", async () => {
    const results = [];
    for (let i = 0; i < 8; i += 1) {
      results.push(await enforcePolicy("payments.checkout", { subject: "org_1:user_1" }, { env }));
    }
    assert.deepEqual(results.map((r) => r === null), [true, true, true, true, true, false, false, false]);
    assert.equal(await enforcePolicy("payments.checkout", { subject: "org_1:user_2" }, { env }), null);
    const refused = results[5]!;
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get("retry-after"), "120", "one checkout token comes back every 2 minutes");
  });

  it("applies 20 password attempts to one address and a 21st is refused", async () => {
    const ip = "198.51.100.23";
    const results = [];
    for (let i = 0; i < 25; i += 1) results.push((await consumePolicy("auth.password-login", { ip }, env)).allowed);
    assert.equal(results.filter(Boolean).length, 20);
  });

  it("uses the looser unknown-address bucket for auth when nobody can be told apart, the stricter one for forms", async () => {
    const auth = [];
    const form = [];
    for (let i = 0; i < 30; i += 1) {
      auth.push((await consumePolicy("auth.password-login", { ip: "unknown" }, env)).allowed);
      form.push((await consumePolicy("public.book-audit", { ip: "unknown" }, env)).allowed);
    }
    assert.equal(auth.every(Boolean), true, "200 shared attempts, not 20");
    assert.equal(form.filter(Boolean).length, 2);
  });

  it("tooManyRequests keeps a route's own body and adds the headers", async () => {
    const result = await consumePolicy("auth.magic-link", { ip: "198.51.100.1" }, env);
    const response = tooManyRequests({ ...result, retryAfterMs: 61_200 }, { error: "rate_limited" }, { "Cache-Control": "no-store, private" });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "62", "rounded up, never down");
    assert.equal(response.headers.get("ratelimit-limit"), "5");
    assert.deepEqual(await response.json(), { error: "rate_limited", retryAfterSeconds: 62 });
  });

  it("never says Retry-After: 0", () => {
    const response = tooManyRequests({ allowed: false, remaining: 0, retryAfterMs: 1, resetAfterMs: 0, limit: 5, tier: "memory" });
    assert.equal(response.headers.get("retry-after"), "1");
  });

  it("covers every policy id with a usable subject", async () => {
    for (const id of Object.keys(POLICIES) as PolicyId[]) {
      const result = await consumePolicy(id, { subject: `probe:${id}` }, env);
      assert.equal(result.allowed, true, id);
      assert.equal(result.limit, POLICIES[id].capacity);
    }
  });
});

describe("client address", () => {
  const withHeader = (name: string, value: string) =>
    new Request("https://tradecatch.test/api/x", { headers: { [name]: value } });
  const production = { NODE_ENV: "production" };

  it("trusts CF-Connecting-IP inside a Cloudflare Worker with no configuration", () => {
    assert.equal(isCloudflareWorker(), false, "this test runs in Node");
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Cloudflare-Workers" }, configurable: true });
    try {
      assert.equal(isCloudflareWorker(), true);
      const req = new Request("https://tradecatch.test/api/x", {
        headers: { "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "6.6.6.6" },
      });
      assert.equal(getClientIp(req, production), "198.51.100.9");
      // Without the header it is "unknown", never a client-supplied forwarding header.
      assert.equal(getClientIp(withHeader("x-forwarded-for", "6.6.6.6"), production), "unknown");
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });

  it("does not trust CF-Connecting-IP on an ordinary server unless told to", () => {
    // Someone can reach such a server directly and send any header they like.
    assert.equal(getClientIp(withHeader("cf-connecting-ip", "198.51.100.9"), production), "unknown");
    assert.equal(getClientIp(withHeader("cf-connecting-ip", "198.51.100.9"), { ...production, CF_TRUSTED: "1" }), "198.51.100.9");
  });

  it("groups an IPv6 customer by /64 and leaves IPv4 and the unknown bucket alone", () => {
    assert.equal(clientIpKey("203.0.113.7"), "203.0.113.7");
    assert.equal(clientIpKey("unknown"), "unknown");
    assert.equal(clientIpKey("unknown:abc"), "unknown:abc");
    assert.equal(clientIpKey("2001:db8:abcd:12::1"), "2001:db8:abcd:12::/64");
    assert.equal(clientIpKey("2001:DB8:ABCD:0012:ffff:eeee:dddd:cccc"), "2001:db8:abcd:12::/64");
    assert.equal(clientIpKey("2001:db8::"), "2001:db8:0:0::/64");
    assert.equal(clientIpKey("::1"), "0:0:0:0::/64");
    assert.equal(clientIpKey("::ffff:203.0.113.7"), "203.0.113.7");
    assert.equal(clientIpKey("fe80::1%eth0"), "fe80:0:0:0::/64");
    assert.equal(clientIpKey("not:an:address"), "not:an:address");
    assert.equal(clientIpKey("1:2:3:4:5:6:7:8:9"), "1:2:3:4:5:6:7:8:9");
  });
});
