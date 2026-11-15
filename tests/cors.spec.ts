import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { E2E_ORIGIN } from "../playwright.config";

/**
 * CORS, end to end. The harness is a development-tier deployment on
 * http://localhost:3100, so its approved frontends are the local dev servers.
 * A real Chromium page "served" from another origin (the document is faked with
 * page.route, the API calls are real) makes the browser itself enforce CORS.
 */
const API = E2E_ORIGIN;
const APPROVED = "http://localhost:3001"; // on the development allowlist
const EXTRA = "http://localhost:3101"; // approved through CORS_ALLOWED_ORIGINS in playwright.config.ts
const UNAPPROVED = "http://localhost:3102"; // same site as the API, on no list
const EVIL = "https://evil.example";
const OPS = "Bearer tradecatch-e2e-ops-secret-not-for-production";
const PASSWORD = "Copper-Pipe-Kettle-82";

const freshIp = () =>
  `2001:db8:${randomUUID().replaceAll("-", "").match(/.{4}/g)!.slice(0, 6).join(":")}`;

/**
 * A private rate-limit identity per test, so parallel tests do not share one
 * bucket (see getClientIp). Two different mechanisms, on purpose:
 *  - The API client sends a synthetic X-Forwarded-For.
 *  - The browser must not: an extra header on a page's requests lands in the
 *    preflight's Access-Control-Request-Headers, and the policy (correctly)
 *    refuses a header it does not list. Its identity is a unique User-Agent,
 *    which is what the limiter falls back to when there is no forwarded address.
 */
const test = base.extend({
  request: async ({ playwright, baseURL }, provide) => {
    const client = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { "x-forwarded-for": freshIp() },
    });
    await provide(client);
    await client.dispose();
  },
  userAgent: async ({ userAgent }, provide) => {
    await provide(`${userAgent ?? "Mozilla/5.0"} cors-spec/${randomUUID()}`);
  },
});

async function accountWithPassword(request: APIRequestContext) {
  const email = `cors-owner-${randomUUID()}@example.test`;
  const provision = await request.post("/api/missed-call/ops/provision-organization", {
    headers: { Authorization: OPS, "X-Ops-Actor": "playwright-cors" },
    data: { email, organizationName: "Cors Plumbing", ownerName: "Cors Owner", locale: "en", plan: "growth" },
  });
  expect(provision.status()).toBe(201);
  const reset = await request.post("/api/auth/forgot-password", { data: { email, locale: "en" } });
  const { devToken } = (await reset.json()) as { devToken?: string };
  expect(devToken).toBeTruthy();
  const set = await request.post("/api/auth/set-password", {
    data: { token: devToken, password: PASSWORD, locale: "en" },
  });
  expect(set.ok()).toBe(true);
  await request.post("/api/auth/logout");
  return email;
}

type Frontend = { origin: string; close: () => Promise<void> };

/**
 * A real web server on loopback, standing in for a TradeCatch frontend on its
 * own origin. It has to be real: a page faked with page.route has no address,
 * so Chromium treats it as public and its Local Network Access check refuses
 * every call to a loopback API before CORS is even consulted.
 */
async function startFrontend(port: number): Promise<Frontend> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>frontend</title><p>frontend</p>");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });
  const bound = (server.address() as AddressInfo).port;
  return {
    origin: `http://localhost:${bound}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

type Outcome = { status: number; body: unknown } | { blocked: true };

/** A credentialed fetch from the page. `blocked` means the browser refused it (a CORS failure). */
async function browserFetch(
  page: Page,
  path: string,
  init: { method?: string; json?: unknown; text?: string } = {},
): Promise<Outcome> {
  return page.evaluate(
    async ({ url, init }) => {
      try {
        const response = await fetch(url, {
          method: init.method ?? "GET",
          credentials: "include",
          headers: init.json !== undefined ? { "Content-Type": "application/json" } : init.text !== undefined ? { "Content-Type": "text/plain" } : undefined,
          body: init.json !== undefined ? JSON.stringify(init.json) : init.text,
        });
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        return { status: response.status, body };
      } catch {
        return { blocked: true as const };
      }
    },
    { url: `${API}${path}`, init },
  );
}

const readable = (outcome: Outcome): outcome is { status: number; body: unknown } => !("blocked" in outcome);

test.describe("preflight and headers", () => {
  const preflight = (request: APIRequestContext, origin: string, method: string, path: string, headers = "content-type, authorization") =>
    request.fetch(path, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": headers },
    });

  test("an approved origin's preflight succeeds for every method and for login, dashboard, appointments, SMS and payments", async ({ request }) => {
    for (const path of [
      "/api/auth/password-login",
      "/api/app/overview",
      "/api/businesses/org_1/appointments",
      "/api/app/sms-receptionist",
      "/api/billing/checkout",
      "/api/billing/portal",
    ]) {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const response = await preflight(request, APPROVED, method, path);
        const headers = response.headers();
        expect(response.status(), `${method} ${path}`).toBe(204);
        expect(headers["access-control-allow-origin"]).toBe(APPROVED);
        expect(headers["access-control-allow-credentials"]).toBe("true");
        expect(headers["access-control-allow-methods"]).toContain(method);
        expect(headers["access-control-allow-headers"]?.toLowerCase()).toContain("authorization");
        expect(headers["access-control-allow-origin"]).not.toBe("*");
        expect(headers["vary"]).toContain("Origin");
      }
    }
  });

  test("an origin added through CORS_ALLOWED_ORIGINS is approved, exactly", async ({ request }) => {
    const response = await preflight(request, EXTRA, "PATCH", "/api/app/overview");
    expect(response.status()).toBe(204);
    expect(response.headers()["access-control-allow-origin"]).toBe(EXTRA);
    expect(response.headers()["access-control-allow-credentials"]).toBe("true");
    // The neighbouring port is a different origin and stays refused.
    expect((await preflight(request, "http://localhost:3103", "GET", "/api/app/overview")).status()).toBe(403);
  });

  test("an unapproved origin's preflight is refused with no CORS headers", async ({ request }) => {
    for (const origin of [EVIL, UNAPPROVED, "https://tradecatch.ca.evil.example", "https://tradecatch.ca", "null"]) {
      const response = await preflight(request, origin, "POST", "/api/app/overview");
      const headers = response.headers();
      expect(response.status(), origin).toBe(403);
      for (const name of ["access-control-allow-origin", "access-control-allow-credentials", "access-control-allow-methods", "access-control-allow-headers"]) {
        expect(headers[name], `${origin} ${name}`).toBeUndefined();
      }
    }
  });

  test("production origins are not approved in a development deployment, and the reverse", async ({ request }) => {
    // The harness is development-tier: the live origins must not be accepted here.
    for (const live of ["https://tradecatch.ca", "https://www.tradecatch.ca"]) {
      const response = await preflight(request, live, "GET", "/api/app/me");
      expect(response.status(), live).toBe(403);
    }
    expect((await preflight(request, APPROVED, "GET", "/api/app/me")).status()).toBe(204);
  });

  test("machine-to-machine routes are never offered, even to an approved origin", async ({ request }) => {
    for (const path of ["/api/webhooks/stripe", "/api/twilio/sms", "/api/website-leads", "/api/ops/demo/reset", "/api/missed-call/escalations/tick", "/api/gmail/sync/tick"]) {
      const response = await preflight(request, APPROVED, "POST", path);
      expect(response.status(), path).toBe(403);
      expect(response.headers()["access-control-allow-origin"], path).toBeUndefined();
      const real = await request.post(path, { headers: { Origin: APPROVED }, data: {} });
      expect(real.headers()["access-control-allow-origin"], path).toBeUndefined();
    }
  });

  test("a normal response carries the policy for an approved origin only, and exactly once", async ({ request }) => {
    const approved = await request.get("/api/health", { headers: { Origin: APPROVED } });
    // /api/health is a probe, not a browser-facing group: no policy even for an approved origin.
    expect(approved.headers()["access-control-allow-origin"]).toBeUndefined();

    const mine = await request.get("/api/app/me", { headers: { Origin: APPROVED } });
    expect(mine.headers()["access-control-allow-origin"]).toBe(APPROVED);
    expect(mine.headers()["access-control-allow-credentials"]).toBe("true");
    expect(mine.headers()["vary"]).toContain("Origin");
    expect(mine.headers()["access-control-allow-origin"]).not.toContain(",");

    for (const origin of [EVIL, UNAPPROVED]) {
      const other = await request.get("/api/app/me", { headers: { Origin: origin } });
      expect(other.headers()["access-control-allow-origin"], origin).toBeUndefined();
      expect(other.headers()["vary"]).toContain("Origin");
    }
    const same = await request.get("/api/app/me", { headers: { Origin: API } });
    expect(same.headers()["access-control-allow-origin"]).toBeUndefined();
  });

  test("the app itself, which calls its API without cross-origin, is unaffected", async ({ page }) => {
    await page.goto("/login");
    const status = await page.evaluate(async () => (await fetch("/api/app/me")).status);
    expect(status).toBe(401); // unauthenticated, but readable: same-origin needs no CORS
  });
});

test.describe("CORS does not replace CSRF or authentication", () => {
  test("a cookie-authenticated write from an unapproved origin is refused before the route runs", async ({ request }) => {
    const response = await request.post("/api/app/api-keys", {
      headers: { Origin: UNAPPROVED, "Sec-Fetch-Site": "cross-site", Cookie: "tc_session=not-a-real-session" },
      data: { name: "x" },
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ error: "Cross-site request blocked." });
    expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
  });

  test("an approved origin passes the CSRF guard but still needs a real session", async ({ request }) => {
    const response = await request.post("/api/app/api-keys", {
      headers: { Origin: APPROVED, "Sec-Fetch-Site": "same-site", Cookie: "tc_session=not-a-real-session" },
      data: { name: "x" },
    });
    expect(response.status()).toBe(401); // authentication still decides
    expect(response.headers()["access-control-allow-origin"]).toBe(APPROVED);
  });
});

test.describe("browser", () => {
  // One worker owns the two frontend servers for the whole group.
  test.describe.configure({ mode: "serial" });

  let approved: Frontend; // localhost:3101, approved through CORS_ALLOWED_ORIGINS
  let unapproved: Frontend; // any free port: on no list
  test.beforeAll(async () => {
    approved = await startFrontend(3101);
    unapproved = await startFrontend(0);
  });
  test.afterAll(async () => {
    await approved?.close();
    await unapproved?.close();
  });

  for (const device of [
    { name: "desktop", viewport: { width: 1280, height: 800 }, isMobile: false },
    { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true },
  ] as const) {
    test.describe(device.name, () => {
      test.use({ viewport: device.viewport, isMobile: device.isMobile, hasTouch: device.isMobile });

      test("an approved frontend signs in, uses the API with its session cookie, and signs out", async ({ page, context, request }) => {
        expect(approved.origin).toBe(EXTRA);
        const email = await accountWithPassword(request);
        await page.goto(approved.origin);

        // Login: a preflighted, credentialed JSON POST.
        const login = await browserFetch(page, "/api/auth/password-login", { method: "POST", json: { email, password: PASSWORD, locale: "en" } });
        expect(readable(login), "login must not be blocked by CORS").toBe(true);
        expect(readable(login) && login.status).toBe(200);
        const session = (await context.cookies(API)).find((cookie) => cookie.name === "tc_session");
        expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax" });

        // The session cookie rides along on later cross-origin calls.
        const me = await browserFetch(page, "/api/app/me");
        expect(readable(me) && me.status).toBe(200);
        const profile = readable(me) ? (me.body as { user: { email: string }; organization: { id: string } }) : null;
        expect(profile?.user.email).toBe(email);

        // Dashboard, appointments, SMS and payments are readable, not blocked.
        for (const [path, init] of [
          ["/api/app/overview", {}],
          [`/api/businesses/${profile!.organization.id}/appointments`, {}],
          ["/api/app/sms-receptionist", {}],
          ["/api/billing/portal", { method: "POST", json: {} }],
          ["/api/billing/checkout", { method: "POST", json: { plan: "growth" } }],
        ] as const) {
          const outcome = await browserFetch(page, path, init);
          expect(readable(outcome), `${path} must be readable`).toBe(true);
        }

        // Every method the app uses survives preflight; the route's own answer (even a 405) is readable.
        for (const method of ["PUT", "PATCH", "DELETE"]) {
          const outcome = await browserFetch(page, "/api/app/me", { method, json: {} });
          expect(readable(outcome), `${method} must not be blocked by CORS`).toBe(true);
        }

        // Signing out works across origins and really ends the session.
        const out = await browserFetch(page, "/api/auth/logout", { method: "POST", json: {} });
        expect(readable(out) && out.status).toBe(200);
        const after = await browserFetch(page, "/api/app/me");
        expect(readable(after) && after.status).toBe(401);
      });

      test("an unapproved origin can neither read the API nor change anything with the visitor's session", async ({ page, request }) => {
        const email = await accountWithPassword(request);
        // The visitor is signed in at the real site...
        const login = await page.request.post("/api/auth/password-login", { data: { email, password: PASSWORD, locale: "en" } });
        expect(login.status()).toBe(200);
        expect((await page.request.get("/api/app/me")).status()).toBe(200);

        // ...and then visits a page from an origin that is not approved.
        await page.goto(unapproved.origin);
        expect(await browserFetch(page, "/api/app/me")).toEqual({ blocked: true });
        expect(await browserFetch(page, "/api/app/overview")).toEqual({ blocked: true });
        // A JSON write dies at the preflight.
        expect(await browserFetch(page, "/api/auth/logout", { method: "POST", json: {} })).toEqual({ blocked: true });
        // A "simple" write needs no preflight; the CSRF guard refuses it with the cookie attached.
        expect(await browserFetch(page, "/api/auth/logout", { method: "POST", text: "{}" })).toEqual({ blocked: true });

        // Nothing happened: the session is intact.
        expect((await page.request.get("/api/app/me")).status()).toBe(200);
      });

      test("an unapproved origin cannot sign anyone in", async ({ page, context, request }) => {
        const email = await accountWithPassword(request);
        await page.goto(unapproved.origin);
        const login = await browserFetch(page, "/api/auth/password-login", { method: "POST", json: { email, password: PASSWORD, locale: "en" } });
        expect(login).toEqual({ blocked: true });
        expect((await context.cookies(API)).some((cookie) => cookie.name === "tc_session")).toBe(false);
      });
    });
  }
});
