import { test, expect } from "@playwright/test";

// Each test uses its own synthetic client IP (the rate limiter keys off
// x-forwarded-for) so tests running in parallel don't exhaust each other's
// rate-limit budget — only the dedicated rate-limit test should ever see 429.
// Randomized (not a shared counter) because fullyParallel runs tests from
// this file across multiple worker processes, each with its own module
// state, so a per-process counter can collide between workers.
function nextTestIp() {
  const octets = Array.from({ length: 4 }, () => Math.floor(Math.random() * 255) + 1);
  return octets.join(".");
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Jean",
    lastName: "Tremblay",
    company: "Tremblay Plomberie",
    trade: "Plumbing",
    email: "jean@example.com",
    phone: "514-555-0100",
    city: "Laval",
    preferredLanguage: "en",
    employees: "5",
    callsPerMonth: "40",
    missedCallsPerWeek: "3",
    afterHours: "no",
    quotesPerMonth: "10",
    averageJobValue: "800",
    currentCrm: "",
    handlesMissedCalls: "",
    followsUpQuotes: "",
    mainProblem: "",
    serviceConsent: true,
    marketingConsent: false,
    consentWording:
      "I agree to be contacted about this request by phone, email or text.",
    consentSource: "book-audit",
    companyWebsite: "",
    turnstileToken: "test-token",
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
}

test.describe("/api/book-audit", () => {
  test("rejects a payload missing required fields", async ({ request }) => {
    const response = await request.post("/api/book-audit", {
      headers: { "x-forwarded-for": nextTestIp() },
      data: { firstName: "Jean" },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });

  test("rejects a payload without required service consent", async ({
    request,
  }) => {
    const response = await request.post("/api/book-audit", {
      headers: { "x-forwarded-for": nextTestIp() },
      data: validPayload({ serviceConsent: false }),
    });
    expect(response.status()).toBe(400);
  });

  test("accepts a fully valid payload", async ({ request }) => {
    const response = await request.post("/api/book-audit", {
      headers: { "x-forwarded-for": nextTestIp() },
      data: validPayload(),
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  test("silently no-ops when the honeypot field is filled", async ({
    request,
  }) => {
    const response = await request.post("/api/book-audit", {
      headers: { "x-forwarded-for": nextTestIp() },
      data: validPayload({ companyWebsite: "https://spambot.example" }),
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    // Honeypot short-circuit returns a bare { ok: true } — no emailSent key —
    // so a real submission's response shape stays distinguishable in tests.
    expect(body).toEqual({ ok: true });
  });

  test("treats a repeated idempotency key as a duplicate", async ({
    request,
  }) => {
    const ip = nextTestIp();
    const payload = validPayload();
    const first = await request.post("/api/book-audit", {
      headers: { "x-forwarded-for": ip },
      data: payload,
    });
    expect(first.status()).toBe(200);

    const second = await request.post("/api/book-audit", {
      headers: { "x-forwarded-for": ip },
      data: payload,
    });
    expect(second.status()).toBe(200);
    const body = await second.json();
    expect(body.duplicate).toBe(true);
  });

  test("rate-limits rapid repeated submissions from the same client", async ({
    request,
  }) => {
    const ip = nextTestIp();
    let sawRateLimit = false;
    for (let i = 0; i < 8; i++) {
      const response = await request.post("/api/book-audit", {
        headers: { "x-forwarded-for": ip },
        data: validPayload(),
      });
      if (response.status() === 429) {
        sawRateLimit = true;
        break;
      }
    }
    expect(sawRateLimit).toBe(true);
  });
});
