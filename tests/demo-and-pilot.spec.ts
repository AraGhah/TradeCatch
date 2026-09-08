import { expect, test } from "@playwright/test";

async function rejectCookiesIfVisible(page: import("@playwright/test").Page) {
  const reject = page.getByRole("button", { name: "Reject non-essential" });
  try {
    await reject.waitFor({ state: "visible", timeout: 2_000 });
    await reject.click();
  } catch {
    // A prior choice in this browser context legitimately means no banner.
  }
}

test.describe("first-demo journeys", () => {
  test("the English demo modal uses the localized video, captions, and honest transcript", async ({
    page,
  }) => {
    await page.goto("/");
    await rejectCookiesIfVisible(page);

    await page
      .getByRole("button", { name: "Watch the 90-second demo" })
      .first()
      .click();

    const dialog = page.getByRole("dialog", { name: "TradeCatch demo" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("video")).toHaveAttribute(
      "src",
      "/demo-video/TradeCatch-Demo-EN.mp4",
    );
    await expect(dialog.locator("track[kind='captions']")).toHaveAttribute(
      "src",
      "/demo-video/captions/en.vtt",
    );

    await dialog.getByText("Transcript", { exact: true }).click();
    await expect(dialog).toContainText("controlled pilot");
    await expect(dialog).toContainText("not self-serve SaaS");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Watch the 90-second demo" }).first(),
    ).toBeFocused();
  });

  test("both exported videos and caption tracks are served", async ({
    request,
  }) => {
    for (const locale of ["EN", "FR"] as const) {
      const video = await request.get(
        `/demo-video/TradeCatch-Demo-${locale}.mp4`,
        { headers: { range: "bytes=0-1" } },
      );
      expect([200, 206]).toContain(video.status());
      expect(video.headers()["content-type"]).toContain("video/mp4");

      const captions = await request.get(
        `/demo-video/captions/${locale.toLowerCase()}.vtt`,
      );
      expect(captions.status()).toBe(200);
      expect(captions.headers()["content-type"]).toContain("text/vtt");
      expect(await captions.text()).toContain("WEBVTT");
    }
  });

  test("cookie rejection persists while the locale switch remains loop-free", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Reject non-essential" }).click();

    const consent = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tradecatch-cookie-consent") || "null"),
    );
    expect(consent).toMatchObject({ version: 1, analytics: false });

    await page
      .locator('button[aria-label="Passer au français"]:visible')
      .click();
    await expect(page).toHaveURL(/\/fr\/?$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(
      page.getByRole("button", { name: "Refuser les non essentiels" }),
    ).toHaveCount(0);

    await page
      .locator('button[aria-label="Switch to English"]:visible')
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("the public audit wizard completes through its confirmation screen", async ({
    page,
  }) => {
    await page.goto("/book-audit");
    await rejectCookiesIfVisible(page);

    await page.locator("#audit-field-firstName").fill("Jamie");
    await page.locator("#audit-field-lastName").fill("Demo");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.locator("#audit-field-company").fill("TradeCatch E2E Plumbing");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByRole("radio", { name: /Plumbing/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await page.locator("#audit-field-email").fill("audit-wizard@example.test");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.locator("#audit-field-phone").fill("514-555-0123");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.locator("#audit-field-city").fill("Laval");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.locator("#audit-field-serviceConsent").check();
    await page.getByRole("button", { name: "Review answers" }).click();
    await expect(
      page.getByRole("heading", {
        name: "Check your answers, then send it over.",
      }),
    ).toBeVisible();

    const submit = page.getByRole("button", { name: "Submit request" });
    await expect(submit).not.toHaveAttribute("aria-disabled", "true");
    await submit.click();
    await expect(
      page.getByRole("heading", { name: "Got it. Your audit request is in." }),
    ).toBeVisible();
  });

  test("founder-provisioned magic-link login reaches an authenticated Starter workspace", async ({
    page,
  }) => {
    const email = `pilot-${Date.now()}-${test.info().workerIndex}@example.test`;
    const provision = await page.request.post(
      "/api/missed-call/ops/provision-organization",
      {
        headers: {
          Authorization: "Bearer tradecatch-e2e-ops-secret-not-for-production",
          "X-Ops-Actor": "playwright-founder-gate",
        },
        data: {
          email,
          organizationName: "TradeCatch E2E Contractor",
          ownerName: "E2E Pilot Owner",
          locale: "en",
          plan: "starter",
        },
      },
    );
    expect(provision.status()).toBe(201);
    expect(await provision.json()).toMatchObject({
      ok: true,
      created: true,
      owner: { email },
      organization: {
        name: "TradeCatch E2E Contractor",
        plan: "starter",
      },
    });

    await page.goto("/login");
    await rejectCookiesIfVisible(page);

    await page.getByLabel("Work email").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();

    const devLink = page.getByRole("link", { name: "Open workspace" });
    await expect(devLink).toBeVisible();
    await devLink.click();
    await expect(page).toHaveURL(/\/app(?:\/)?$/);

    const me = await page.request.get("/api/app/me");
    expect(me.status()).toBe(200);
    const body = (await me.json()) as {
      user: { email: string };
      organization: { plan: string; name: string };
    };
    expect(body.user.email).toBe(email);
    expect(body.organization).toMatchObject({
      plan: "starter",
      name: "TradeCatch E2E Contractor",
    });
  });
});
