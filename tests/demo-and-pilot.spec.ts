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
  test("the English demo button opens the one universal video with captions and an honest label", async ({
    page,
  }) => {
    await page.goto("/");
    await rejectCookiesIfVisible(page);

    await page
      .getByRole("button", { name: "Watch the demo", exact: true })
      .first()
      .click();

    const dialog = page.getByRole("dialog", {
      name: "Under the sink: the Receptionist answers",
    });
    await expect(dialog).toBeVisible();
    const video = dialog.locator("video");
    await expect(video).toHaveAttribute(
      "src",
      "/demo-video/stories/under-the-sink-en.mp4",
    );
    await expect(video).toHaveAttribute(
      "poster",
      "/demo-video/stories/under-the-sink-poster.jpg",
    );
    // Captions are a separate track the viewer can switch off, never burned in.
    await expect(dialog.locator("track[kind='captions']")).toHaveAttribute(
      "src",
      "/demo-video/stories/captions/under-the-sink-en.vtt",
    );

    // The honesty label is visible without opening anything.
    await expect(dialog).toContainText(
      "A dramatization with a fictional business, not a customer story",
    );

    // The receptionist takes a request; the team confirms. It never books a slot itself.
    await dialog.getByText("Transcript", { exact: true }).click();
    await expect(dialog).toContainText("I’ve sent your request to the team");
    await expect(dialog).not.toContainText("I’ve booked");
    await expect(dialog).not.toContainText("transfer");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Watch the demo", exact: true }).first(),
    ).toBeFocused();
  });

  test("the video card on the home page opens a labelled player that fits on screen (English)", async ({
    page,
  }) => {
    await page.goto("/");
    await rejectCookiesIfVisible(page);

    const card = page.getByRole("button", {
      name: "Watch the video: Under the sink",
    });
    await card.scrollIntoViewIfNeeded();
    await card.click();

    const dialog = page.getByRole("dialog", {
      name: "Under the sink: the Receptionist answers",
    });
    await expect(dialog).toBeVisible();
    const video = dialog.locator("video");

    // Portrait player: 4:5, and the whole video fits on screen with its controls.
    const box = await video.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box).not.toBeNull();
    expect(box!.width / box!.height).toBeCloseTo(0.8, 1);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(card).toBeFocused();
  });

  test("the same video plays in French with French captions and label", async ({
    page,
  }) => {
    await page.goto("/fr");
    await page
      .getByRole("button", { name: "Refuser les non essentiels" })
      .click({ timeout: 2_000 })
      .catch(() => undefined);

    const card = page.getByRole("button", {
      name: "Regarder la vidéo : Sous l’évier",
    });
    await card.scrollIntoViewIfNeeded();
    await card.click();

    const dialog = page.getByRole("dialog", {
      name: "Sous l'évier : la réceptionniste répond",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("video")).toHaveAttribute(
      "src",
      "/demo-video/stories/under-the-sink-fr.mp4",
    );
    await expect(dialog.locator("track[kind='captions']")).toHaveAttribute(
      "src",
      "/demo-video/stories/captions/under-the-sink-fr.vtt",
    );
    await expect(dialog).toContainText(
      "Une mise en scène avec une entreprise fictive, pas un témoignage de client",
    );
  });

  test("the receptionist page offers the single video and no other cut", async ({
    page,
  }) => {
    await page.goto("/receptionist");
    await rejectCookiesIfVisible(page);
    await expect(
      page.getByRole("button", { name: "Watch the video: Under the sink" }),
    ).toBeVisible();
    for (const retired of ["After hours", "On the ladder"]) {
      await expect(
        page.getByRole("button", { name: `Watch the video: ${retired}` }),
      ).toHaveCount(0);
    }
    await expect(
      page.getByRole("button", { name: "Watch the missed-call demo" }),
    ).toHaveCount(0);
  });

  test("the retired interactive demo page sends visitors home", async ({
    request,
  }) => {
    const response = await request.get("/demo-video", { maxRedirects: 0 });
    expect([307, 308]).toContain(response.status());
    expect(new URL(response.headers()["location"]!, "http://x").pathname).toBe(
      "/",
    );
  });

  test("the demo video, its caption tracks and poster are served in both languages", async ({
    request,
  }) => {
    const poster = await request.get(
      "/demo-video/stories/under-the-sink-poster.jpg",
    );
    expect(poster.status()).toBe(200);
    expect(poster.headers()["content-type"]).toContain("image/jpeg");
    for (const locale of ["en", "fr"] as const) {
      const mp4 = await request.get(
        `/demo-video/stories/under-the-sink-${locale}.mp4`,
        { headers: { range: "bytes=0-1" } },
      );
      expect([200, 206]).toContain(mp4.status());
      expect(mp4.headers()["content-type"]).toContain("video/mp4");

      const vtt = await request.get(
        `/demo-video/stories/captions/under-the-sink-${locale}.vtt`,
      );
      expect(vtt.status()).toBe(200);
      expect(vtt.headers()["content-type"]).toContain("text/vtt");
      expect(await vtt.text()).toContain("WEBVTT");
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

  test("the public audit wizard shows a save error when durable storage is disabled", async ({
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

    const submit = page.locator('button[type="submit"]');
    await expect(submit).not.toHaveAttribute("aria-disabled", "true");
    const response = page.waitForResponse("**/api/book-audit");
    await submit.click();
    expect((await response).status()).toBe(503);
    await expect(
      page.getByRole("heading", { name: "Got it. Your audit request is in." }),
    ).not.toBeVisible();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "We couldn’t submit your audit request" }),
    ).toBeVisible();
    await expect(submit).toHaveAttribute("aria-busy", "false");
    await expect(
      page.getByRole("heading", {
        name: "Check your answers, then send it over.",
      }),
    ).toBeVisible();
  });

  test("founder-provisioned magic-link login reaches an authenticated Essential workspace", async ({
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
          plan: "essential",
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
        plan: "essential",
      },
    });

    await page.goto("/login");
    await rejectCookiesIfVisible(page);

    await page.getByLabel("Work email").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();

    const devLink = page.getByRole("link", { name: "Open workspace" });
    await expect(devLink).toBeVisible();
    const callbackUrl = await devLink.getAttribute("href");
    expect(callbackUrl).toBeTruthy();
    // An email gateway can inspect the same link without signing anyone in.
    const scan = await page.request.get(callbackUrl!);
    expect(scan.status()).toBe(200);
    expect(scan.headers()["referrer-policy"]).toBe("no-referrer");
    expect(scan.headers()["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect(await scan.text()).toContain("Confirm your sign-in");
    expect((await page.request.get("/api/app/me")).status()).toBe(401);
    await page.request.head(callbackUrl!);
    await devLink.click();
    await expect(
      page.getByRole("heading", { name: "Confirm your sign-in" }),
    ).toBeVisible();
    await page.reload();
    expect((await page.request.get("/api/app/me")).status()).toBe(401);
    await page.getByRole("button", { name: "Confirm and sign in" }).click();
    await expect(page).toHaveURL(/\/app(?:\/)?$/);

    const me = await page.request.get("/api/app/me");
    expect(me.status()).toBe(200);
    const body = (await me.json()) as {
      user: { email: string };
      organization: { plan: string; name: string };
    };
    expect(body.user.email).toBe(email);
    expect(body.organization).toMatchObject({
      plan: "essential",
      name: "TradeCatch E2E Contractor",
    });
  });
});
