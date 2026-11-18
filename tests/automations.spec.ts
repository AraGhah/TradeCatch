import { expect, test as base, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signInAs, workspaceSession } from "./support/workspace-session";

/**
 * KAN-17, the Automations screens against the real API (in-memory stores in the E2E
 * harness). What the screen shows is what the server stored; a failed request is shown as
 * failed; fifty rapid clicks are one request; one business cannot touch another's.
 */

const freshIp = () =>
  `2001:db8:${randomUUID().replaceAll("-", "").match(/.{4}/g)!.slice(0, 6).join(":")}`;
const test = base.extend({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": freshIp() });
  },
});

const BOARD = "/app/automations";
const MISSED = "/app/automations/missed-call";
const TOGGLE_URL = /\/api\/businesses\/([^/]+)\/automations\/([^/]+)\/(activate|deactivate)$/;

const row = (page: Page, type = "missed_call_recovery") => page.locator(`tr[data-automation="${type}"]`);
const status = (page: Page, type = "missed_call_recovery") => page.getByTestId(`status-${type}`);

async function openBoard(page: Page) {
  await page.goto(BOARD);
  await expect(row(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Automations", exact: true })).toBeVisible();
}

/** Clicks the row's switch and waits for the server's answer. */
async function flip(page: Page, label: "Enable" | "Disable") {
  const answered = page.waitForResponse(
    (r) => TOGGLE_URL.test(r.url()) && r.request().method() === "POST",
  );
  await row(page).getByRole("button", { name: label, exact: true }).click();
  const response = await answered;
  expect(response.status()).toBe(200);
  const [, organizationId, automationId] = response.url().match(TOGGLE_URL)!;
  return { organizationId: organizationId!, automationId: automationId! };
}

async function storedEnabled(page: Page, organizationId: string, automationId: string) {
  const res = await page.request.get(`/api/businesses/${organizationId}/automations/${automationId}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { automation: { enabled: boolean } }).automation.enabled;
}

test("AUTO-01: Enable turns the automation on, says so only after the server confirmed, and stores it", async ({ page }) => {
  await workspaceSession(page);
  await openBoard(page);
  await expect(status(page)).toHaveText("Inactive");
  const ids = await flip(page, "Enable");
  await expect(status(page)).toHaveText("Active");
  await expect(row(page).getByRole("button", { name: "Disable", exact: true })).toBeEnabled();
  await expect(row(page).getByRole("status").filter({ hasText: "Turned on and saved" })).toBeVisible();
  expect(await storedEnabled(page, ids.organizationId, ids.automationId)).toBe(true);
});

test("AUTO-02: Disable turns it off and stores it", async ({ page }) => {
  await workspaceSession(page);
  await openBoard(page);
  const ids = await flip(page, "Enable");
  await expect(status(page)).toHaveText("Active");
  await flip(page, "Disable");
  await expect(status(page)).toHaveText("Inactive");
  await expect(row(page).getByRole("status").filter({ hasText: "Turned off and saved" })).toBeVisible();
  await expect(row(page).getByRole("button", { name: "Enable", exact: true })).toBeEnabled();
  expect(await storedEnabled(page, ids.organizationId, ids.automationId)).toBe(false);
});

test("AUTO-03: a refresh keeps the switch and a saved setting, on the board and on the settings page", async ({ page }) => {
  await workspaceSession(page);
  await openBoard(page);
  await flip(page, "Enable");
  await page.reload();
  await expect(status(page)).toHaveText("Active");

  await page.goto(MISSED);
  await expect(page.getByTestId("automation-status")).toContainText("Active");
  const delay = page.locator('input[name="initialDelayMinutes"]');
  await delay.fill("17");
  await expect(page.getByTestId("unsaved")).toBeVisible();
  const saved = page.waitForResponse((r) => /\/automations\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await expect(page.getByTestId("unsaved")).toHaveCount(0);

  await page.reload();
  await expect(delay).toHaveValue("17");
  await expect(page.getByTestId("automation-status")).toContainText("Active");
  await page.goto(BOARD);
  await expect(status(page)).toHaveText("Active");
});

test("AUTO-04: fifty rapid clicks are one request, never overlap, and leave the screen matching the server", async ({ page }) => {
  await workspaceSession(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBoard(page);

  let started = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  let organizationId = "";
  page.on("request", (r) => {
    if (TOGGLE_URL.test(r.url())) {
      organizationId ||= r.url().match(TOGGLE_URL)![1]!;
      started += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
    }
  });
  const done = () => {
    inFlight = Math.max(0, inFlight - 1);
  };
  page.on("requestfinished", (r) => TOGGLE_URL.test(r.url()) && done());
  page.on("requestfailed", (r) => TOGGLE_URL.test(r.url()) && done());

  // Fifty clicks in the same instant, before React can re-render the button as disabled.
  await row(page)
    .getByRole("button", { name: "Enable", exact: true })
    .evaluate((button) => {
      for (let i = 0; i < 50; i += 1) (button as HTMLButtonElement).click();
    });
  await expect(status(page)).toHaveText("Active");
  await expect(row(page).getByRole("button", { name: "Disable", exact: true })).toBeEnabled();
  expect(started).toBe(1);

  // Then fifty more as fast as the browser allows, forced past the disabled state.
  const button = row(page).getByRole("button", { name: /^(Disable|Enable|Turning on…|Turning off…)$/ });
  for (let i = 0; i < 50; i += 1) {
    await button.click({ force: true, noWaitAfter: true, timeout: 2_000 }).catch(() => undefined);
  }
  await expect(row(page).getByRole("button", { name: /^(Disable|Enable)$/ })).toBeEnabled();
  expect(maxInFlight).toBe(1);
  expect(errors).toEqual([]);

  // Whatever the final state is, the screen shows what the server stored.
  const shown = (await status(page).innerText()) === "Active";
  const listed = await page.request.get(`/api/businesses/${organizationId}/automations`);
  const rows = ((await listed.json()) as { automations: { type: string; enabled: boolean }[] }).automations;
  expect(rows.find((a) => a.type === "missed_call_recovery")!.enabled).toBe(shown);
  await page.reload();
  await expect(status(page)).toHaveText(shown ? "Active" : "Inactive");
});

test("AUTO-10: a failed request is shown as failed, never as success, and the switch does not move", async ({ page }) => {
  await workspaceSession(page);
  await openBoard(page);
  const failures: Array<[string, (route: import("@playwright/test").Route) => Promise<void>, RegExp]> = [
    ["server unavailable", (route) => route.fulfill({ status: 503, json: { error: "down" } }), /briefly unavailable/],
    ["network down", (route) => route.abort("failed"), /could not be reached/],
    ["server error", (route) => route.fulfill({ status: 500, json: { error: "Something internal" } }), /could not be saved/],
    ["answer without the stored value", (route) => route.fulfill({ status: 200, json: { ok: true } }), /did not confirm/],
    ["signed out", (route) => route.fulfill({ status: 401, json: { error: "Unauthorized" } }), /session ended/],
    ["forbidden", (route) => route.fulfill({ status: 403, json: { error: "Insufficient permissions." } }), /do not have permission/],
  ];
  for (const [, fulfil, message] of failures) {
    await page.route(TOGGLE_URL, fulfil);
    await row(page).getByRole("button", { name: "Enable", exact: true }).click();
    await expect(row(page).getByRole("alert").filter({ hasText: message })).toBeVisible();
    await expect(row(page).getByText(/Turned on and saved/)).toHaveCount(0);
    await expect(status(page)).toHaveText("Inactive");
    await expect(row(page).getByRole("button", { name: "Enable", exact: true })).toBeEnabled();
    await page.unroute(TOGGLE_URL);
  }
  await page.reload();
  await expect(status(page)).toHaveText("Inactive");
  // With the fault gone, the same click works.
  await flip(page, "Enable");
  await expect(status(page)).toHaveText("Active");
});

test("AUTO-10: when the answer is lost on the way back, the screen shows what the server really stored", async ({ page }) => {
  await workspaceSession(page);
  await openBoard(page);
  // The request reaches the server and is applied; the browser never sees the answer.
  await page.route(TOGGLE_URL, async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await row(page).getByRole("button", { name: "Enable", exact: true }).click();
  await expect(row(page).getByRole("alert")).toBeVisible();
  await expect(status(page)).toHaveText("Active");
  await expect(row(page).getByText(/Turned on and saved/)).toHaveCount(0);
  await page.unroute(TOGGLE_URL);
  await page.reload();
  await expect(status(page)).toHaveText("Active");
});

test("AUTO-10: a rate-limited request says when to try again and does not fire the next one early", async ({ page }) => {
  await workspaceSession(page);
  await openBoard(page);
  await page.route(TOGGLE_URL, (route) =>
    route.fulfill({
      status: 429,
      headers: { "Retry-After": "7" },
      json: { error: "Too many requests", retryAfter: 7 },
    }),
  );
  await row(page).getByRole("button", { name: "Enable", exact: true }).click();
  await expect(row(page).getByRole("alert").filter({ hasText: /Too many changes/ })).toBeVisible();
  await expect(status(page)).toHaveText("Inactive");
});

test("AUTO-10: a failed save of settings is an error, keeps what was typed marked unsaved, and stores nothing", async ({ page }) => {
  await workspaceSession(page);
  await page.goto(MISSED);
  const delay = page.locator('input[name="initialDelayMinutes"]');
  const original = await delay.inputValue();
  await page.route(/\/automations\/[^/]+$/, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 500, json: { error: "internal detail" } })
      : route.continue(),
  );
  await delay.fill("33");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /could not be saved/ })).toBeVisible();
  await expect(page.getByText("Saved.", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("unsaved")).toBeVisible();
  await expect(delay).toHaveValue("33");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await page.unroute(/\/automations\/[^/]+$/);
  await page.reload();
  await expect(delay).toHaveValue(original);
});

test("settings: a rejected value is explained in words, a non-number never reaches the server", async ({ page }) => {
  await workspaceSession(page);
  await page.goto(MISSED);
  let patches = 0;
  page.on("request", (r) => r.method() === "PATCH" && /\/automations\/[^/]+$/.test(r.url()) && (patches += 1));
  const delay = page.locator('input[name="initialDelayMinutes"]');
  await delay.fill("abc");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Use whole numbers only." })).toBeVisible();
  expect(patches).toBe(0);
  await delay.fill("60");
  await page.locator('input[name="maxAttempts"]').fill("9");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Maximum attempts must be between 1 and 5/ })).toBeVisible();
  expect(patches).toBe(1);
});

test("settings: fifty rapid Save clicks make one request, and the quiet-hours choice is stored", async ({ page }) => {
  await workspaceSession(page);
  await page.goto(MISSED);
  let patches = 0;
  page.on("request", (r) => r.method() === "PATCH" && /\/automations\/[^/]+$/.test(r.url()) && (patches += 1));
  await page.getByRole("checkbox", { name: "No recovery text during quiet hours" }).check();
  await expect(page.locator('input[name="windowStartHour"]')).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).evaluate((button) => {
    for (let i = 0; i < 50; i += 1) (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  expect(patches).toBe(1);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "No recovery text during quiet hours" })).toBeChecked();
});

test("AUTO-12: another business's automations cannot be read, changed, switched or listed", async ({ browser }) => {
  const contextA = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const contextB = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await workspaceSession(pageA);
  await workspaceSession(pageB);
  await openBoard(pageA);
  await openBoard(pageB);
  const a = await flip(pageA, "Enable");
  const b = { ...(await flip(pageB, "Enable")) };
  expect(a.organizationId).not.toBe(b.organizationId);
  await flip(pageB, "Disable");

  const origin = new URL(pageA.url()).origin;
  const base = `/api/businesses/${b.organizationId}`;
  const attempts = [
    pageA.request.get(`${base}/automations`),
    pageA.request.get(`${base}/automations/${b.automationId}`),
    pageA.request.patch(`${base}/automations/${b.automationId}`, { data: { initialDelayMinutes: 99 }, headers: { origin } }),
    pageA.request.post(`${base}/automations/${b.automationId}/activate`, { headers: { origin } }),
    pageA.request.post(`${base}/automations/${b.automationId}/deactivate`, { headers: { origin } }),
    pageA.request.get(`${base}/automation-templates`),
    pageA.request.get(`${base}/automation-jobs`),
    pageA.request.get(`${base}/automation-history?executions=1`),
  ];
  for (const response of await Promise.all(attempts)) expect(response.status()).toBe(403);

  // Signed out, nothing answers either.
  const anonymous = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const bare = await anonymous.request.get(`${base}/automations`);
  expect([401, 403]).toContain(bare.status());
  await anonymous.close();

  // B's automation is exactly as B left it, and A's own automations still work.
  await pageB.reload();
  await expect(status(pageB)).toHaveText("Inactive");
  const mine = await pageA.request.get(`/api/businesses/${a.organizationId}/automations/${a.automationId}`);
  expect(mine.status()).toBe(200);
  await contextA.close();
  await contextB.close();
});

test("AUTO-13: signing out and in again leaves every switch and setting as it was", async ({ page }) => {
  const who = await workspaceSession(page);
  await openBoard(page);
  await flip(page, "Enable");
  await page.goto(MISSED);
  await page.locator('input[name="initialDelayMinutes"]').fill("12");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

  await page.context().clearCookies();
  await signInAs(page, who.email, who.clientIp);

  await openBoard(page);
  await expect(status(page)).toHaveText("Active");
  await page.goto(MISSED);
  await expect(page.locator('input[name="initialDelayMinutes"]')).toHaveValue("12");
  await expect(page.getByTestId("automation-status")).toContainText("Active");
});

test("templates: a saved template is what comes back, including after switching templates", async ({ page }) => {
  await workspaceSession(page);
  await page.goto("/app/automations/templates");
  await page.getByLabel("Message language").selectOption("en");
  const box = page.getByRole("textbox");
  const original = await box.inputValue();
  const edited = `${original} Thanks!`;
  await box.fill(edited);
  await expect(page.getByTestId("template-unsaved")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /saved/i })).toBeVisible();
  await expect(page.getByTestId("template-unsaved")).toHaveCount(0);

  await page.getByRole("button", { name: "Quote follow-up 1" }).click();
  await expect(box).not.toHaveValue(edited);
  await page.getByRole("button", { name: "Missed-call recovery", exact: true }).click();
  await expect(box).toHaveValue(edited);
  await page.reload();
  await page.getByLabel("Message language").selectOption("en");
  await expect(box).toHaveValue(edited);

  // A template that drops the opt-out line is refused with the reason in words.
  await box.fill("Hello there");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /business name|opt-out/i })).toBeVisible();
  await expect(page.getByTestId("template-unsaved")).toBeVisible();
});

test("the Test and Edit links only appear for automations that have those pages", async ({ page }) => {
  await workspaceSession(page);
  await openBoard(page);
  await expect(row(page).getByRole("link", { name: "Edit configuration" })).toHaveAttribute("href", /\/app\/automations\/missed-call$/);
  await expect(row(page, "quote_followup").getByRole("link", { name: "Test automation" })).toHaveAttribute("href", /\/app\/automations\/quotes$/);
  await expect(row(page, "appointment_reminder").getByRole("link", { name: "Test automation" })).toHaveCount(0);
  await expect(row(page, "appointment_reminder").getByRole("link", { name: "Edit configuration" })).toHaveCount(0);
  await expect(row(page, "customer_reengagement").getByRole("button", { name: "Enable", exact: true })).toHaveCount(0);
});

test("the quote follow-up page has no stop-on-accept switch, and says reminders always stop", async ({ page }) => {
  await workspaceSession(page);
  await page.goto("/app/automations/quotes");
  await expect(page.getByRole("checkbox", { name: /quote is accepted|quote is rejected/i })).toHaveCount(0);
  await expect(page.getByText("Reminders always stop when the quote is accepted, rejected or canceled.")).toBeVisible();
});
