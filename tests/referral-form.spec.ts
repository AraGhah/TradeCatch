import { expect, test } from "@playwright/test";

// Each test uses its own synthetic client IP: the rate limiter keys off
// x-forwarded-for, and only the dedicated rate-limit test should see a 429.
function nextTestIp() {
  return Array.from(
    { length: 4 },
    () => Math.floor(Math.random() * 255) + 1,
  ).join(".");
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    referrerName: "Sam Tremblay",
    referrerEmail: "sam@example.test",
    referralCode: "",
    contactName: "Alex Roy",
    businessName: "Roy Plomberie",
    contactEmail: "",
    contactPhone: "514-555-0187",
    note: "",
    language: "en",
    permissionConfirmed: true,
    companyWebsite: "",
    turnstileToken: "test-token",
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
}

test.describe("/api/referrals/submit", () => {
  test("rejects a payload missing required fields", async ({ request }) => {
    const response = await request.post("/api/referrals/submit", {
      headers: { "x-forwarded-for": nextTestIp() },
      data: { referrerName: "Sam" },
    });
    expect(response.status()).toBe(400);
  });

  test("rejects a referral without the permission confirmation", async ({
    request,
  }) => {
    const response = await request.post("/api/referrals/submit", {
      headers: { "x-forwarded-for": nextTestIp() },
      data: validPayload({ permissionConfirmed: false }),
    });
    expect(response.status()).toBe(400);
  });

  test("rejects a referral with no way to reach the contact", async ({
    request,
  }) => {
    const response = await request.post("/api/referrals/submit", {
      headers: { "x-forwarded-for": nextTestIp() },
      data: validPayload({ contactPhone: "", contactEmail: "" }),
    });
    expect(response.status()).toBe(400);
  });

  test("silently no-ops when the honeypot field is filled", async ({
    request,
  }) => {
    const response = await request.post("/api/referrals/submit", {
      headers: { "x-forwarded-for": nextTestIp() },
      data: validPayload({ companyWebsite: "https://spam.example" }),
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("accepts a valid referral in the e2e harness", async ({ request }) => {
    const response = await request.post("/api/referrals/submit", {
      headers: { "x-forwarded-for": nextTestIp() },
      data: validPayload(),
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  test("rate-limits rapid repeated submissions from the same client", async ({
    request,
  }) => {
    const ip = nextTestIp();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const response = await request.post("/api/referrals/submit", {
        headers: { "x-forwarded-for": ip },
        data: validPayload({ idempotencyKey: crypto.randomUUID() }),
      });
      statuses.push(response.status());
    }
    expect(statuses).toContain(429);
  });
});

test.describe("referral page form", () => {
  test("validates, submits and confirms (en)", async ({ page }) => {
    await page.goto("/referral");
    await page
      .getByRole("button", { name: "Reject non-essential" })
      .click()
      .catch(() => {});

    const form = page.locator("#refer");
    await form.getByRole("button", { name: "Send referral" }).click();
    await expect(form.getByRole("alert").first()).toBeVisible();
    await expect(page.locator("#referral-field-referrerName")).toBeFocused();

    await page.locator("#referral-field-referrerName").fill("Sam Tremblay");
    await page.locator("#referral-field-referrerEmail").fill("sam@example.test");
    await page.locator("#referral-field-contactName").fill("Alex Roy");
    await page.locator("#referral-field-businessName").fill("Roy Plomberie");
    await form.getByRole("button", { name: "Send referral" }).click();
    await expect(form).toContainText("Add a phone number or an email.");
    await expect(form).toContainText("Please confirm you have their permission.");

    await page.locator("#referral-field-contactPhone").fill("514-555-0187");
    await page.locator("#referral-field-permissionConfirmed").check();
    await form.getByRole("button", { name: "Send referral" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Referral received" }),
    ).toBeVisible();
  });

  test("renders in French with French validation", async ({ page }) => {
    await page.goto("/fr/parrainage");
    await page
      .getByRole("button", { name: "Refuser les non essentiels" })
      .click()
      .catch(() => {});
    const form = page.locator("#refer");
    await expect(
      form.getByRole("heading", { name: "Parrainer un entrepreneur" }),
    ).toBeVisible();
    await form.getByRole("button", { name: "Envoyer le parrainage" }).click();
    await expect(form).toContainText("Ce champ est obligatoire.");
  });
});
