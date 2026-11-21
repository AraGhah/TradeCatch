import { expect, test as base, type Locator, type Page, type Route } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMINS, adminSession, uniqueSuffix } from "./support/admin-session";
import { waitForElementHydration, waitForFormHydration } from "./support/hydration";
import { workspaceSession } from "./support/workspace-session";

/**
 * KAN-26: loading, processing and feedback states, LOAD-01 .. LOAD-15.
 *
 * Every test drives a real page against the real E2E harness and only holds,
 * delays, drops or fails the request it is about (page.route), so what is checked
 * is what a person would see. Slow and dead networks are made by holding the
 * request; the 30-second wait is crossed with Playwright's clock, not by waiting.
 *
 * Unit coverage of the same rules (the single-flight lock, the timeout race, the
 * unknown-outcome wording) is in tests/unit/action-runner.test.ts and
 * tests/unit/guarded-handler.test.ts.
 */

const read = (locale: "en" | "fr") =>
  JSON.parse(readFileSync(join(process.cwd(), "src", "messages", `${locale}.json`), "utf8")) as {
    login: Record<string, string>;
    feedback: Record<string, string> & { errors: Record<string, string> };
    app: {
      privacy: Record<string, string>;
      schedule: Record<string, string>;
      account: Record<string, string>;
      alerts: Record<string, string>;
    };
  };
const EN = read("en");
const FR = read("fr");

// Each test gets its own client address, so parallel tests cannot spend each other's rate-limit quota.
const freshIp = () =>
  `2001:db8:${randomUUID().replaceAll("-", "").match(/.{4}/g)!.slice(0, 6).join(":")}`;
const test = base.extend({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": freshIp() });
  },
});

const PRIVACY = "/app/receptionist/privacy";
const PRIVACY_FR = "/fr/app/receptionniste/confidentialite";
const BOOKINGS = "/app/bookings";
const NOTIFICATIONS = "/app/settings/notifications";
const PRIVACY_API = "**/api/businesses/*/privacy";

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

type Release =
  | "continue"
  | "abort"
  /** The server did the work, but the answer never reached the page. */
  | "processed-but-lost"
  | { status: number; json?: unknown; headers?: Record<string, string> };

/** Holds every request of one method to a URL until the test lets it go; counts them. */
async function hold(page: Page, glob: string, method: string) {
  const waiting: Route[] = [];
  const bodies: string[] = [];
  let count = 0;
  await page.route(glob, (route) => {
    if (route.request().method() !== method) return route.continue();
    count += 1;
    bodies.push(route.request().postData() ?? "");
    waiting.push(route);
    return undefined;
  });
  return {
    count: () => count,
    bodies: () => bodies,
    async release(how: Release = "continue") {
      for (const route of waiting.splice(0)) {
        try {
          if (how === "continue") await route.continue();
          else if (how === "abort") await route.abort("connectionreset");
          else if (how === "processed-but-lost") {
            await route.fetch();
            await route.abort("connectionreset");
          } else await route.fulfill({ status: how.status, json: how.json ?? {}, headers: how.headers });
        } catch {
          // The page navigated away, so the browser already cancelled this request.
        }
      }
    },
  };
}

/** Fifty clicks (or submits) in ONE task, before React can re-render: what a held Enter key or a frantic tap does. */
const burstClick = (target: Locator, times = 50) =>
  target.evaluate((element, n) => {
    for (let i = 0; i < n; i += 1) (element as HTMLElement).click();
  }, times);
const burstSubmit = (form: Locator, times = 50) =>
  form.evaluate((element, n) => {
    for (let i = 0; i < n; i += 1) (element as HTMLFormElement).requestSubmit();
  }, times);

/** Lets any wrongly-sent extra request arrive before the count is read. */
const settle = (page: Page) => page.waitForTimeout(400);

const spinnerIn = (target: Locator) => target.getByTestId("spinner");
const alerts = (page: Page) => page.locator("main").getByRole("alert");
const skeletons = (page: Page) => page.locator("main").getByTestId("skeleton");

const OPS = "Bearer tradecatch-e2e-ops-secret-not-for-production";
const PASSWORD = "Copper-Pipe-Kettle-82";

async function rejectCookiesIfVisible(page: Page) {
  const reject = page.getByRole("button", { name: "Reject non-essential" });
  try {
    await reject.waitFor({ state: "visible", timeout: 2_000 });
    await reject.click();
  } catch {
    // A prior choice in this browser context legitimately means no banner.
  }
}

async function openLogin(page: Page, locale: "en" | "fr" = "en") {
  await page.goto(locale === "fr" ? "/fr/connexion" : "/login");
  await rejectCookiesIfVisible(page);
  await waitForFormHydration(page);
  const t = locale === "fr" ? FR : EN;
  await page.locator('input[type="email"]').fill("nobody@example.invalid");
  await page.locator('input[type="password"]').fill("Copper-Pipe-Kettle-82");
  return {
    form: page.locator("main form"),
    submit: page.getByRole("button", { name: t.login.passwordSubmit, exact: true }),
    busy: page.getByRole("button", { name: t.login.passwordSending, exact: true }),
  };
}

async function openPrivacy(page: Page, locale: "en" | "fr" = "en") {
  const t = locale === "fr" ? FR : EN;
  const loaded = page.waitForResponse(
    (r) => /\/api\/businesses\/[^/]+\/privacy$/.test(r.url()) && r.request().method() === "GET",
  );
  await page.goto(locale === "fr" ? PRIVACY_FR : PRIVACY);
  expect((await loaded).status()).toBe(200);
  await expect(page.getByRole("button", { name: t.app.privacy.save, exact: true })).toBeVisible();
}

const privacySave = (page: Page, locale: "en" | "fr" = "en") =>
  page.getByRole("button", { name: (locale === "fr" ? FR : EN).app.privacy.save, exact: true });
const recordVoicemails = (page: Page) => page.getByRole("checkbox", { name: "Record voicemails" });

/** The business's own appointment API, for what is really stored. */
async function professionalWorkspace(page: Page) {
  await workspaceSession(page, "en", "professional");
  const me = (await (await page.request.get("/api/app/me")).json()) as { organization: { id: string } };
  return me.organization.id;
}
async function storedAppointments(page: Page, id: string) {
  const listing = (await (await page.request.get(`/api/businesses/${id}/appointments`)).json()) as {
    appointments: { customerName?: string; startAt: string }[];
  };
  return listing.appointments;
}

/** Books through the calendar picker, as a person does; returns the chosen time. */
async function chooseTime(page: Page, customer: string) {
  const picker = page.getByTestId("schedule-picker");
  await expect(picker.locator("button[data-date]").first()).toBeVisible();
  let day = picker.locator("button[data-date]:not([disabled])").first();
  if ((await day.count()) === 0) {
    await picker.getByRole("button", { name: /Next month/ }).click();
    day = picker.locator("button[data-date]:not([disabled])").first();
  }
  await expect(day).toBeVisible();
  await day.click();
  const slot = picker.locator("button[data-slot]").first();
  await expect(slot).toBeVisible();
  const startAt = (await slot.getAttribute("data-slot"))!;
  await slot.click();
  await page.getByRole("textbox", { name: "Customer", exact: true }).fill(customer);
  return startAt;
}

/* ------------------------------------------------------------------ */

test("LOAD-01: submitting a form shows that it is processing (sign in)", async ({ page }) => {
  const { submit, busy, form } = await openLogin(page);
  const held = await hold(page, "**/api/auth/password-login", "POST");

  await submit.click();

  // Words, a spinner, a disabled button, and the busy state for assistive technology.
  await expect(busy).toBeVisible();
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute("aria-busy", "true");
  await expect(spinnerIn(busy)).toBeVisible();
  await expect(form).toHaveAttribute("aria-busy", "true");
  // Nothing says it worked, or failed, while the answer is still on its way.
  await expect(alerts(page)).toHaveCount(0);
  expect(page.url()).toContain("/login");

  // The server says no (the details are not an account): processing ends, the form is usable again, the words are kept.
  await held.release("continue");
  await expect(alerts(page).filter({ hasText: EN.login.errorInvalid.slice(0, 30) })).toBeVisible();
  await expect(submit).toBeEnabled();
  await expect(submit).toHaveAttribute("aria-busy", "false");
  await expect(spinnerIn(submit)).toHaveCount(0);
  await expect(page.locator('input[type="email"]')).toHaveValue("nobody@example.invalid");
});

for (const surface of ["sign in", "privacy settings", "notification preferences"] as const) {
  test(`LOAD-02: fifty clicks in one instant give one operation (${surface})`, async ({ page }) => {
    if (surface === "sign in") {
      const { form } = await openLogin(page);
      const held = await hold(page, "**/api/auth/password-login", "POST");
      await burstSubmit(form, 50);
      await expect.poll(() => held.count()).toBe(1);
      await settle(page);
      expect(held.count()).toBe(1);
      // The browser did not submit the form by itself either (a dropped submit event is still cancelled).
      expect(page.url()).toContain("/login");
      await held.release();
    } else if (surface === "privacy settings") {
      await workspaceSession(page);
      await openPrivacy(page);
      const held = await hold(page, PRIVACY_API, "PATCH");
      await recordVoicemails(page).check();
      await burstClick(privacySave(page), 50);
      await expect.poll(() => held.count()).toBe(1);
      await settle(page);
      expect(held.count()).toBe(1);
      await held.release();
      await expect(page.getByRole("status").filter({ hasText: EN.app.privacy.saved })).toBeVisible();
      expect(held.count()).toBe(1);
    } else {
      await workspaceSession(page);
      await page.goto(NOTIFICATIONS);
      const form = page
        .locator("form")
        .filter({ has: page.locator('select option[value="assigned"]') });
      await expect(form).toBeVisible();
      await waitForElementHydration(page, "form select");
      const held = await hold(page, "**/api/businesses/*/notification-preferences", "PUT");
      await form
        .locator("select")
        .filter({ has: page.locator('option[value="fr"]') })
        .selectOption("fr");
      await burstSubmit(form, 50);
      await expect.poll(() => held.count()).toBe(1);
      await settle(page);
      expect(held.count()).toBe(1);
      await held.release();
      await expect(form.getByRole("status")).toContainText(EN.app.alerts.saved);
    }
  });
}

test("LOAD-03: a successful save clears the loading state and confirms what is really stored", async ({ page }) => {
  await workspaceSession(page);
  await openPrivacy(page);
  const held = await hold(page, PRIVACY_API, "PATCH");
  await recordVoicemails(page).check();
  await privacySave(page).click();

  const saving = page.getByRole("button", { name: EN.app.privacy.saving, exact: true });
  await expect(saving).toBeVisible();
  await expect(spinnerIn(saving)).toBeVisible();
  // Not confirmed yet: nothing says saved while the save is still out.
  await expect(page.getByText(EN.app.privacy.saved)).toHaveCount(0);

  await held.release("continue");
  await expect(page.getByRole("status").filter({ hasText: EN.app.privacy.saved })).toBeVisible();
  await expect(privacySave(page)).toBeEnabled();
  await expect(spinnerIn(privacySave(page))).toHaveCount(0);
  await expect(page.getByRole("button", { name: EN.app.privacy.saving })).toHaveCount(0);

  // "Saved" was true: a fresh page load, from the server, shows the new value.
  await page.reload();
  await openPrivacy(page);
  await expect(recordVoicemails(page)).toBeChecked();
});

test("LOAD-04: an API failure clears the loading state, says so, keeps the input", async ({ page }) => {
  await workspaceSession(page);
  await openPrivacy(page);
  const held = await hold(page, PRIVACY_API, "PATCH");
  await recordVoicemails(page).check();
  await privacySave(page).click();
  await expect(page.getByRole("button", { name: EN.app.privacy.saving, exact: true })).toBeVisible();

  await held.release({ status: 503, json: { error: "Unable to save privacy settings." } });

  await expect(alerts(page).filter({ hasText: "Your changes were not saved" })).toBeVisible();
  await expect(page.getByText(EN.app.privacy.saved)).toHaveCount(0);
  await expect(privacySave(page)).toBeEnabled();
  await expect(spinnerIn(privacySave(page))).toHaveCount(0);
  await expect(recordVoicemails(page)).toBeChecked();
  await expect(page.getByTestId("unsaved-callRecordingEnabled")).toBeVisible();
});

test("LOAD-05: a request that never answers ends in an error and can be retried safely", async ({ page }) => {
  await workspaceSession(page);
  // The clock is installed before the page loads so the wait can be crossed without waiting.
  await page.clock.install();
  await openPrivacy(page);
  const held = await hold(page, PRIVACY_API, "PATCH");
  await recordVoicemails(page).check();
  await privacySave(page).click();
  await expect(page.getByRole("button", { name: EN.app.privacy.saving, exact: true })).toBeVisible();

  // Nothing ever answers. Thirty-one seconds later the page gives up.
  await page.clock.fastForward(31_000);

  // It cannot know whether the save happened, so it says exactly that: not "saved", not "failed".
  const alert = alerts(page).filter({ hasText: "could not confirm" });
  await expect(alert).toBeVisible();
  await expect(page.getByText(EN.app.privacy.saved)).toHaveCount(0);
  await expect(privacySave(page)).toBeEnabled();
  await expect(spinnerIn(privacySave(page))).toHaveCount(0);

  // A retry is offered (the save is safe to repeat: nothing is saved twice) and works.
  await page.unroute(PRIVACY_API);
  void held;
  await alert.getByRole("button", { name: EN.feedback.retry }).click();
  await expect(page.getByRole("status").filter({ hasText: EN.app.privacy.saved })).toBeVisible();
  await expect(privacySave(page)).toBeEnabled();
});

test("LOAD-06: the calendar shows a skeleton and a words-and-spinner status while it loads, then neither", async ({ page }) => {
  await professionalWorkspace(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
        if (!entry.hadRecentInput) w.__cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  const held = await hold(page, "**/api/businesses/*/appointments", "GET");
  await page.goto(BOOKINGS);

  const loading = page.getByRole("status").filter({ hasText: EN.app.schedule.loadingAppointments });
  await expect(loading).toBeVisible();
  await expect(spinnerIn(loading)).toBeVisible();
  await expect(skeletons(page).first()).toBeVisible();
  // The grid is not drawn from nothing, and the counters do not claim "0" about a calendar that has not been read.
  await expect(page.getByTestId("calendar-grid")).toHaveCount(0);

  await expect.poll(() => held.count()).toBe(1);
  await held.release();
  await expect(page.getByTestId("calendar-grid")).toBeVisible();
  await expect(loading).toHaveCount(0);
  await expect(skeletons(page)).toHaveCount(0);

  // The skeleton has the calendar's shape, so the page does not jump when the data arrives.
  const shift = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  console.log(`LOAD-06 cumulative layout shift: ${shift.toFixed(3)}`);
  expect(shift).toBeLessThan(0.25);
});

test("LOAD-07: confirming a booking fifty times, or after a lost answer, books it once", async ({ page }) => {
  const id = await professionalWorkspace(page);
  await page.goto(BOOKINGS);
  await expect(page.getByTestId("calendar-grid")).toBeVisible();

  // 1. A burst while the first request is out: one request, with the booking's idempotency key.
  const startAt = await chooseTime(page, "Burst Customer");
  const held = await hold(page, `**/api/businesses/${id}/appointments`, "POST");
  const confirm = page.getByRole("button", { name: "Confirm Appointment" });
  await burstClick(confirm, 50);
  await expect.poll(() => held.count()).toBe(1);
  const saving = page.getByRole("button", { name: EN.app.schedule.saving, exact: true });
  await expect(saving).toBeVisible();
  await expect(spinnerIn(saving)).toBeVisible();
  await settle(page);
  expect(held.count()).toBe(1);

  // 2. The server books it, but the answer is lost on the way back: the page must not say "failed" or "confirmed".
  await held.release("processed-but-lost");
  await expect(
    alerts(page).filter({ hasText: "could not confirm this booking" }),
  ).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Appointment confirmed for" })).toHaveCount(0);
  await expect(confirm).toBeEnabled();
  expect((await storedAppointments(page, id)).filter((row) => row.customerName === "Burst Customer")).toHaveLength(1);

  // 3. Confirming again sends the SAME key, and the server returns the booking it already has: still one.
  await confirm.click();
  await expect.poll(() => held.count()).toBe(2);
  const [first, second] = held.bodies().map((body) => JSON.parse(body) as { idempotencyKey?: string; startAt: string });
  expect(first!.idempotencyKey).toBeTruthy();
  expect(second!.idempotencyKey).toBe(first!.idempotencyKey);
  expect(second!.startAt).toBe(startAt);
  await held.release("continue");
  await expect(page.getByRole("status").filter({ hasText: /Appointment confirmed for|request/i })).toBeVisible();
  expect((await storedAppointments(page, id)).filter((row) => row.customerName === "Burst Customer")).toHaveLength(1);
});

test("LOAD-08: opening checkout fifty times creates one session request, and a lost answer is not called a failure", async ({ page }) => {
  await workspaceSession(page, "en", "essential");
  await page.goto("/billing");
  const start = page.getByRole("button", { name: EN.app.account.checkoutStart, exact: true });
  await expect(start).toBeVisible();
  await waitForElementHydration(page, "main button");
  const held = await hold(page, "**/api/billing/checkout", "POST");

  await burstClick(start, 50);
  await expect.poll(() => held.count()).toBe(1);
  const opening = page.getByRole("button", { name: EN.app.account.checkoutOpening, exact: true });
  await expect(opening).toBeVisible();
  await expect(opening).toBeDisabled();
  await expect(spinnerIn(opening)).toBeVisible();
  await settle(page);
  expect(held.count()).toBe(1);

  // No answer: it cannot tell whether a session was made, and says nothing was charged.
  await held.release("abort");
  await expect(
    alerts(page).filter({ hasText: "could not confirm that checkout opened" }),
  ).toBeVisible();
  await expect(start).toBeEnabled();

  // A real answer sends the browser to Stripe once, and the button stays busy meanwhile.
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<h1>stripe stand-in</h1>" }),
  );
  await start.click();
  await expect.poll(() => held.count()).toBe(2);
  await held.release({ status: 200, json: { url: "https://checkout.stripe.com/c/pay/cs_test_load08" } });
  await expect(page).toHaveURL(/checkout\.stripe\.com\/c\/pay\//);
  expect(held.count()).toBe(2);
});

test("LOAD-08b: coming back from Stripe says 'Confirming your payment…' until our server has it, and never offers to pay again meanwhile", async ({ page }) => {
  await workspaceSession(page, "en", "essential");
  // The clock is installed first so the one minute of re-checking can be crossed without waiting for it.
  await page.clock.install();
  const pageReads: string[] = [];
  page.on("request", (request) => {
    if (/\/billing(\?|$)/.test(request.url()) && request.headers()["rsc"]) pageReads.push(request.url());
  });
  await page.goto("/billing?checkout=success&session_id=cs_test_load08b");
  const start = page.getByRole("button", { name: EN.app.account.checkoutStart, exact: true });

  // The harness has no payment record, which is exactly "Stripe sent us back, our webhook has not arrived".
  const confirming = page.getByTestId("checkout-confirming");
  await expect(confirming).toBeVisible();
  await expect(confirming).toContainText(EN.app.account.checkoutConfirming);
  await expect(spinnerIn(confirming)).toBeVisible();
  await expect(start).toHaveCount(0);
  // It does not claim the payment is confirmed, and it announces itself politely.
  await expect(page.getByText(EN.app.account.checkoutConfirmed)).toHaveCount(0);
  await expect(confirming.getByRole("status")).toBeVisible();

  // It re-reads the page on its own, a bounded number of times, then stops and says so. The clock is
  // stepped (not jumped): each check is scheduled only after the previous one has re-rendered.
  await page.clock.runFor(4_100);
  await expect.poll(() => pageReads.length).toBeGreaterThanOrEqual(1);
  const slow = page.getByTestId("checkout-confirmation-slow");
  for (let step = 0; step < 25 && (await slow.count()) === 0; step += 1) {
    await page.clock.runFor(4_100);
    await page.waitForTimeout(120);
  }
  await expect(slow).toBeVisible();
  await expect(slow).toContainText("do not pay again");
  await expect(confirming).toHaveCount(0);
  await settle(page);
  const reads = pageReads.length;
  expect(reads, "it re-read the page more than once, but a bounded number of times").toBeGreaterThan(5);
  expect(reads).toBeLessThanOrEqual(16);
  for (let step = 0; step < 5; step += 1) {
    await page.clock.runFor(30_000);
    await page.waitForTimeout(100);
  }
  expect(pageReads.length, "no endless polling after it gave up").toBe(reads);
  await expect(start).toHaveCount(0);

  // "Try again" re-reads once, and the watching starts over.
  await slow.getByRole("button", { name: EN.feedback.retry }).click();
  await expect(confirming).toBeVisible();

  // Backing out of Stripe is different: nothing was paid, so the way to pay is back, with a plain note.
  await page.goto("/billing?checkout=canceled");
  await expect(page.getByText(EN.app.account.checkoutCanceledNote)).toBeVisible();
  await expect(start).toBeVisible();
});

test("LOAD-09: signing in shows 'Signing in…' and a double submit signs in once", async ({ page }) => {
  const email = `load-09-${randomUUID()}@example.test`;
  const created = await page.request.post("/api/missed-call/ops/provision-organization", {
    headers: { Authorization: OPS, "X-Ops-Actor": "playwright-loading-states" },
    data: { email, organizationName: "Loading Plumbing", ownerName: "Load Owner", locale: "en", plan: "essential" },
  });
  expect(created.status()).toBe(201);

  // Choose a password through the reset link, as a customer does, then sign out.
  await page.goto("/forgot-password");
  await rejectCookiesIfVisible(page);
  await waitForFormHydration(page);
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If that email has an account");
  await page.getByRole("link", { name: "Choose a new password" }).click();
  await waitForFormHydration(page);
  await page.getByLabel("New password").fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Save password and sign in" }).click();
  await expect(page).toHaveURL(/\/app(?:\/)?$/);
  await page.request.post("/api/auth/logout");
  await page.context().clearCookies();

  // Now the sign-in under test, with the answer held.
  await page.goto("/login");
  await waitForFormHydration(page);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  const held = await hold(page, "**/api/auth/password-login", "POST");
  await burstSubmit(page.locator("main form"), 50);

  await expect.poll(() => held.count()).toBe(1);
  const busy = page.getByRole("button", { name: EN.login.passwordSending, exact: true });
  await expect(busy).toBeVisible();
  await expect(busy).toBeDisabled();
  await expect(spinnerIn(busy)).toBeVisible();
  await settle(page);
  expect(held.count()).toBe(1);

  await held.release();
  await expect(page).toHaveURL(/\/app(?:\/)?$/);
  expect(held.count()).toBe(1);
});

test("LOAD-10: privacy shows 'saved' only after the server confirmed it, never on a missing or malformed answer", async ({ page }) => {
  await workspaceSession(page);
  await openPrivacy(page);
  await recordVoicemails(page).check();

  // A 200 whose body is not the saved settings is not a confirmation.
  await page.route(PRIVACY_API, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 200, contentType: "text/plain", body: "ok" })
      : route.continue(),
  );
  await privacySave(page).click();
  await expect(alerts(page).filter({ hasText: "could not confirm" })).toBeVisible();
  await expect(page.getByText(EN.app.privacy.saved)).toHaveCount(0);
  await expect(page.getByTestId("unsaved-callRecordingEnabled")).toBeVisible();

  // The real answer confirms it, and only then does the page say so and drop the "Not saved" mark.
  await page.unroute(PRIVACY_API);
  const held = await hold(page, PRIVACY_API, "PATCH");
  await privacySave(page).click();
  await expect(page.getByText(EN.app.privacy.saved)).toHaveCount(0);
  await expect(page.getByTestId("unsaved-callRecordingEnabled")).toBeVisible();
  await held.release();
  await expect(page.getByRole("status").filter({ hasText: EN.app.privacy.saved })).toBeVisible();
  await expect(page.getByTestId("unsaved-callRecordingEnabled")).toHaveCount(0);
});

test("LOAD-11: an admin action shows its progress and its result, once", async ({ page }) => {
  await adminSession(page, ADMINS.super("26"));
  const suffix = uniqueSuffix();
  const created = await page.request.post("/api/admin/businesses", {
    data: {
      organizationName: `Loading Plumbing ${suffix}`,
      ownerName: "Load Owner",
      ownerEmail: `load-${suffix}@example.test`,
      plan: "essential",
      locale: "en",
      sendInvite: false,
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const STATUS_API = `**/api/admin/businesses/${id}/status`;
  const statusForm = () => page.locator("form").filter({ hasText: "Account status" });

  const held = await hold(page, STATUS_API, "POST");
  await page.goto(`/admin/businesses/${id}`);
  await page.getByLabel("Account status").selectOption("churned");
  await page.getByLabel("Type the confirmation word").fill("deactivate");
  const save = statusForm().getByRole("button", { name: "Save", exact: true });
  await burstClick(save, 5);

  const working = statusForm().getByRole("button", { name: "Saving…", exact: true });
  await expect(working).toBeVisible();
  await expect(spinnerIn(working)).toBeVisible();
  await expect(working).toBeDisabled();
  await expect(page.getByText("Saved.", { exact: true })).toHaveCount(0);
  await settle(page);
  expect(held.count()).toBe(1);

  await held.release();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await expect(working).toHaveCount(0);
  await expect(save).toBeEnabled();
  expect(held.count()).toBe(1);

  // A server failure is not reported as "not applied" (it may have been): it says it could not confirm, and the button is usable again.
  await page.unroute(STATUS_API);
  await page.route(STATUS_API, (route) => route.fulfill({ status: 503, json: { error: "down" } }));
  await page.reload();
  await page.getByLabel("Account status").selectOption("active");
  await page.getByLabel("Type the confirmation word").fill("activate");
  await save.click();
  await expect(alerts(page).filter({ hasText: "could not confirm" })).toBeVisible();
  await expect(page.getByText("Saved.", { exact: true })).toHaveCount(0);
  await expect(save).toBeEnabled();
  await expect(spinnerIn(save)).toHaveCount(0);
});

test("LOAD-12: leaving a page while a request is out causes no error and no stale update", async ({ page }) => {
  await workspaceSession(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  // A read that is still loading when the person moves on.
  const read = await hold(page, PRIVACY_API, "GET");
  await page.goto(PRIVACY);
  await expect(page.getByRole("status").filter({ hasText: EN.app.privacy.loading })).toBeVisible();
  await page.goto("/app/settings");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await read.release();
  await settle(page);
  // The old page's answer arrived; it neither crashed the new page nor wrote into it.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(EN.app.privacy.save)).toHaveCount(0);
  expect(page.url()).toContain("/app/settings");

  // A write that is still out when the person moves on (a client-side move, so the page unmounts).
  await page.unroute(PRIVACY_API);
  await openPrivacy(page);
  const write = await hold(page, PRIVACY_API, "PATCH");
  await recordVoicemails(page).check();
  await privacySave(page).click();
  await expect.poll(() => write.count()).toBe(1);
  await page.locator('aside a[href$="/app/settings"]').first().click();
  await expect(page).toHaveURL(/\/app\/settings\/?$/);
  await write.release("continue");
  await settle(page);
  await expect(page).toHaveURL(/\/app\/settings\/?$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  expect(errors.filter((text) => !/Failed to load resource|ERR_ABORTED|net::/.test(text))).toEqual([]);
});

test("LOAD-13: the loading, saving and error words follow the language (French)", async ({ page }) => {
  await workspaceSession(page, "fr");
  const held = await hold(page, PRIVACY_API, "GET");
  await page.goto(PRIVACY_FR);
  const loading = page.getByRole("status").filter({ hasText: FR.app.privacy.loading });
  await expect(loading).toBeVisible();
  await expect(loading).not.toContainText(EN.app.privacy.loading);
  await expect.poll(() => held.count()).toBe(1);
  await held.release();
  await expect(privacySave(page, "fr")).toBeVisible();

  const patch = await hold(page, PRIVACY_API, "PATCH");
  await recordVoicemails(page).or(page.getByRole("checkbox").first()).first().check();
  await privacySave(page, "fr").click();
  const saving = page.getByRole("button", { name: FR.app.privacy.saving, exact: true });
  await expect(saving).toBeVisible();
  await patch.release({ status: 503, json: { error: "x" } });
  await expect(alerts(page).filter({ hasText: FR.app.privacy.saveError.slice(0, 25) })).toBeVisible();
  await expect(page.getByRole("button", { name: FR.app.privacy.saving })).toHaveCount(0);

  // And the sign-in page, the first thing a customer sees.
  const { submit } = await (async () => {
    await page.context().clearCookies();
    return openLogin(page, "fr");
  })();
  const login = await hold(page, "**/api/auth/password-login", "POST");
  await submit.click();
  await expect(page.getByRole("button", { name: FR.login.passwordSending, exact: true })).toBeVisible();
  await login.release();
});

test.describe("LOAD-14: a phone", () => {
  test.use({ viewport: { width: 375, height: 700 } });
  const overflow = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  test("loading and processing states fit the screen and leave the rest of the page usable", async ({ page }) => {
    // Sign in page, mid-request.
    const { busy, submit } = await openLogin(page);
    const held = await hold(page, "**/api/auth/password-login", "POST");
    await submit.click();
    await expect(busy).toBeVisible();
    const box = (await busy.boundingBox())!;
    expect(box.height, "a thumb-sized button").toBeGreaterThanOrEqual(40);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // Only the form's own controls wait: the language and help links are not disabled.
    await expect(page.getByRole("link", { name: EN.login.forgot })).toBeEnabled();
    await held.release();
    await expect(submit).toBeEnabled();

    // A loading screen (skeleton) and a saving screen.
    await workspaceSession(page);
    const read = await hold(page, PRIVACY_API, "GET");
    await page.goto(PRIVACY);
    await expect(page.getByRole("status").filter({ hasText: EN.app.privacy.loading })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expect.poll(() => read.count()).toBe(1);
    await read.release();
    await expect(privacySave(page)).toBeVisible();
    const write = await hold(page, PRIVACY_API, "PATCH");
    await recordVoicemails(page).check();
    await privacySave(page).click();
    const saving = page.getByRole("button", { name: EN.app.privacy.saving, exact: true });
    await expect(saving).toBeVisible();
    const savingBox = (await saving.boundingBox())!;
    expect(savingBox.x + savingBox.width).toBeLessThanOrEqual(375);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // The checkboxes the person is not saving are still there to read; navigation is not disabled.
    await expect(page.getByRole("link").first()).toBeVisible();
    await write.release();
    await expect(page.getByRole("status").filter({ hasText: EN.app.privacy.saved })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test("the calendar skeleton fits a phone", async ({ page }) => {
    await professionalWorkspace(page);
    const held = await hold(page, "**/api/businesses/*/appointments", "GET");
    await page.goto(BOOKINGS);
    await expect(page.getByRole("status").filter({ hasText: EN.app.schedule.loadingAppointments })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expect.poll(() => held.count()).toBe(1);
    await held.release();
    await expect(page.getByTestId("calendar-grid")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});

test("LOAD-15: repeated failures never leave a button disabled or a spinner running", async ({ page }) => {
  await workspaceSession(page);
  await openPrivacy(page);
  await recordVoicemails(page).check();

  const failures: Release[] = [
    { status: 503, json: { error: "down" } },
    "abort",
    { status: 500, json: { error: "boom" } },
    "abort",
    { status: 502, json: {} },
    { status: 503, json: { error: "down" } },
  ];
  for (const [index, failure] of failures.entries()) {
    const held = await hold(page, PRIVACY_API, "PATCH");
    await privacySave(page).click();
    await expect.poll(() => held.count(), `request ${index + 1} left the page`).toBe(1);
    await held.release(failure);
    await expect(alerts(page).first(), `failure ${index + 1} is shown`).toBeVisible();
    await expect(privacySave(page), `button after failure ${index + 1}`).toBeEnabled();
    await expect(privacySave(page)).toHaveAttribute("aria-busy", "false");
    await expect(page.getByTestId("spinner"), `spinner after failure ${index + 1}`).toHaveCount(0);
    await page.unroute(PRIVACY_API);
  }

  // And the page still works: the next try, with a working server, saves.
  await privacySave(page).click();
  await expect(page.getByRole("status").filter({ hasText: EN.app.privacy.saved })).toBeVisible();
  await expect(privacySave(page)).toBeEnabled();
});
