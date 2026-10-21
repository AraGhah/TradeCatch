import { test, expect } from "@playwright/test";

test.describe("security headers", () => {
  test("home page sets CSP, HSTS, and framing/content-type protections", async ({
    request,
  }) => {
    const response = await request.get("/");
    const headers = response.headers();
    const csp = headers["content-security-policy"] ?? "";

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // OpenNext Cloudflare: static CSP with unsafe-inline (no per-request nonce).
    // Nonce + strict-dynamic mismatched asset hashes and blocked all client JS.
    expect(csp).toMatch(/script-src[^;]*'self'/);
    expect(csp).toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).not.toContain("strict-dynamic");
    expect(csp).not.toMatch(/nonce-[A-Za-z0-9+/=]+/);
    expect(csp).not.toContain("unsafe-eval");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    const permissions = headers["permissions-policy"] ?? "";
    expect(permissions).toContain("camera=()");
    expect(permissions).toContain("geolocation=()");
    // The receptionist demo listens through the microphone: this origin only,
    // never an embedded frame.
    expect(permissions).toContain("microphone=(self)");
    expect(permissions).not.toContain("microphone=*");
  });

  test("public health liveness marker is TradeCatch-specific", async ({
    request,
  }) => {
    const response = await request.get("/api/health");
    expect(response.headers()["x-tradecatch-live"]).toBe("1");
    expect(response.headers()["x-tradecatch-ready"]).toBeUndefined();
    const body = await response.json();
    expect(body.service).toBe("tradecatch");
    expect(body.livenessMarker).toBe("tradecatch-live");
    expect(body.readyMarker).toBeUndefined();
  });

  test("api route also receives the shared security headers", async ({
    request,
  }) => {
    const response = await request.post("/api/book-audit", { data: {} });
    const headers = response.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });

  test("no API route opts in to cross-origin access", async ({ request }) => {
    const origin = "https://evil.example";
    for (const path of ["/api/health", "/api/app/me", "/api/book-audit"]) {
      const simple = await request.get(path, { headers: { Origin: origin } });
      expect(simple.headers()["access-control-allow-origin"], path).toBeUndefined();
      const preflight = await request.fetch(path, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });
      expect(preflight.headers()["access-control-allow-origin"], path).toBeUndefined();
      expect(preflight.headers()["access-control-allow-credentials"], path).toBeUndefined();
    }
  });

  test("a cross-site write that carries a session cookie is refused before the route runs", async ({
    request,
  }) => {
    const response = await request.post("/api/app/api-keys", {
      headers: { "Sec-Fetch-Site": "cross-site", Cookie: "tc_session=not-a-real-session" },
      data: { name: "x" },
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ error: "Cross-site request blocked." });
  });

  test("malformed and oversized requests get a plain error with no internals", async ({
    request,
  }) => {
    const leaks = /node_modules|\.tsx?:\d+|\bat \S+ \(|ECONNREFUSED|password|secret|postgres/i;
    // Webhooks answer to anyone on the internet, so they are the routes to probe.
    // (They are not behind the shared per-IP budgets other specs count on.)
    const forged = await request.post("/api/webhooks/stripe", {
      headers: { "Content-Type": "application/json", "Stripe-Signature": "t=1,v1=00" },
      data: "{not json",
    });
    expect(forged.status()).toBe(401);
    expect(await forged.json()).toEqual({ error: "Invalid webhook signature." });

    const huge = await request.post("/api/webhooks/stripe", {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ filler: "x".repeat(600_000) }),
    });
    expect(huge.status()).toBe(413);
    expect(await huge.text()).not.toMatch(leaks);

    const wrongToken = await request.post("/api/webhooks/gmail?token=wrong", { data: {} });
    expect(wrongToken.status()).toBe(401);
    expect(await wrongToken.json()).toEqual({ error: "unauthorized" });
    const garbage = await request.post("/api/webhooks/gmail?token=e2e-gmail-webhook-token", {
      headers: { "Content-Type": "application/json" },
      data: "{not json",
    });
    expect(garbage.status()).toBe(401);
    expect(await garbage.json()).toEqual({ error: "unauthorized" });

    const calendar = await request.post("/api/webhooks/google-calendar", {
      headers: { "X-Goog-Channel-Id": "org_x" },
    });
    expect(calendar.status()).toBe(401);
    expect(await calendar.text()).not.toMatch(leaks);

    const missing = await request.get("/api/does-not-exist");
    expect(missing.status()).toBe(404);
    expect(await missing.text()).not.toMatch(leaks);
  });
});
