import { test, expect } from "@playwright/test";

test.describe("security headers", () => {
  test("home page sets nonce CSP, HSTS, and framing/content-type protections", async ({
    request,
  }) => {
    const response = await request.get("/");
    const headers = response.headers();
    const csp = headers["content-security-policy"] ?? "";

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("strict-dynamic");
    expect(csp).toMatch(/nonce-[A-Za-z0-9+/=]+/);
    expect(csp).not.toContain("unsafe-eval");
    // Document CSP uses nonces instead of script unsafe-inline.
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
  });

  test("health readiness marker is TradeCatch-specific", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.headers()["x-tradecatch-ready"]).toBe("1");
    const body = await response.json();
    expect(body.service).toBe("tradecatch");
    expect(body.readyMarker).toBe("tradecatch-ready");
  });

  test("api route also receives the shared security headers", async ({
    request,
  }) => {
    const response = await request.post("/api/book-audit", { data: {} });
    const headers = response.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });
});
