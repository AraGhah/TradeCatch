import { test, expect } from "@playwright/test";

test.describe("security headers", () => {
  test("home page sets CSP, HSTS, and framing/content-type protections", async ({
    request,
  }) => {
    const response = await request.get("/");
    const headers = response.headers();

    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
  });

  test("api route also receives the shared security headers", async ({
    request,
  }) => {
    const response = await request.post("/api/book-audit", { data: {} });
    const headers = response.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });
});
