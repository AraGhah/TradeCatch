import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bookAuditSchema } from "../../src/lib/validation/book-audit";
import { rateLimit } from "../../src/lib/rate-limit";

const validBase = {
  firstName: "Jean",
  lastName: "Tremblay",
  company: "Tremblay Plomberie",
  trade: "Plumbing",
  email: "jean@example.com",
  phone: "514-555-0100",
  city: "Laval",
  preferredLanguage: "en" as const,
  employees: "2–5",
  callsPerMonth: "50–150",
  missedCallsPerWeek: "5–15",
  afterHours: "Sometimes",
  quotesPerMonth: "10–30",
  averageJobValue: "$1,000–$5,000",
  currentCrm: "",
  handlesMissedCalls: "Me, the owner",
  followsUpQuotes: "Office staff",
  mainProblem: "",
  serviceConsent: true as const,
  marketingConsent: false,
  companyWebsite: "",
  turnstileToken: "test-token",
};

describe("bookAuditSchema", () => {
  it("accepts a fully valid payload", () => {
    const result = bookAuditSchema.safeParse(validBase);
    assert.equal(result.success, true);
  });

  it("rejects missing service consent", () => {
    const result = bookAuditSchema.safeParse({
      ...validBase,
      serviceConsent: false,
    });
    assert.equal(result.success, false);
  });

  it("rejects invalid email", () => {
    const result = bookAuditSchema.safeParse({
      ...validBase,
      email: "not-an-email",
    });
    assert.equal(result.success, false);
  });

  it("rejects short phone numbers", () => {
    const result = bookAuditSchema.safeParse({
      ...validBase,
      phone: "123",
    });
    assert.equal(result.success, false);
  });
});

describe("rateLimit", () => {
  it("allows requests under the limit and blocks after", () => {
    const key = `unit-test-${Date.now()}-${Math.random()}`;
    const windowMs = 60_000;
    const limit = 3;

    assert.equal(rateLimit({ key, limit, windowMs }).allowed, true);
    assert.equal(rateLimit({ key, limit, windowMs }).allowed, true);
    assert.equal(rateLimit({ key, limit, windowMs }).allowed, true);
    assert.equal(rateLimit({ key, limit, windowMs }).allowed, false);
  });
});
