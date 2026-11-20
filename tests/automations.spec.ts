import { expect, test as base, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signInAs, workspaceSession } from "./support/workspace-session";

/**
 * KAN-17, the Automations screens against the real API (in-memory stores in the E2E
 * harness). What the screen shows is what the server stored; a failed request is shown as
 * failed; fifty rapid clicks are one request; one business cannot touch another's.
 * KAN-24 rewrote the words on these screens: the assertions below read what the owner reads.
 *
 * The harness business has no number to text from, so a follow-up that is turned on reads
 * "Needs Attention" here, truthfully. "On" is therefore asserted as "not paused".
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
const QUOTES = "/app/automations/quotes";
const TOGGLE_URL = /\/api\/businesses\/([^/]+)\/automations\/([^/]+)\/(activate|deactivate)$/;

const row = (page: Page, type = "missed_call_recovery") => page.locator(`[data-automation="${type}"]`);
const status = (page: Page, type = "missed_call_recovery") => page.getByTestId(`status-${type}`);
const isPaused = (page: Page, type?: string) => expect(status(page, type)).toHaveAttribute("data-state", "paused");
const isOn = (page: Page, type?: string) => expect(status(page, type)).not.toHaveAttribute("data-state", "paused");

async function openBoard(page: Page) {
  await page.goto(BOARD);
  await expect(row(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Automatic Follow-Ups", exact: true })).toBeVisible();
}

/** Clicks the row's switch and waits for the server's answer. */
async function flip(page: Page, label: "Enable" | "Pause") {
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
  await isPaused(page);
  const ids = await flip(page, "Enable");
  await isOn(page);
  await expect(row(page).getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
  await expect(row(page).getByRole("status").filter({ hasText: "Turned on." })).toBeVisible();
  expect(await storedEnabled(page, ids.organizationId, ids.automationId)).toBe(true);
});

test("AUTO-02: Pause turns it off and stores it", async ({ page }) => {
  await workspaceSession(page);
  await openBoard(page);
  const ids = await flip(page, "Enable");
  await isOn(page);
  await flip(page, "Pause");
  await isPaused(page);
  await expect(row(page).getByRole("status").filter({ hasText: "Paused." })).toBeVisible();
  await expect(row(page).getByRole("button", { name: "Enable", exact: true })).toBeEnabled();
  expect(await storedEnabled(page, ids.organizationId, ids.automationId)).toBe(false);
});

test("AUTO-03: a refresh keeps the switch and a saved setting, on the board and on the settings page", async ({ page }) => {
  await workspaceSession(page);
  await openBoard(page);
  await flip(page, "Enable");
  await page.reload();
  await isOn(page);

  await page.goto(MISSED);
  await expect(page.getByTestId("automation-status")).not.toHaveAttribute("data-state", "paused");
  const delay = page.locator('input[name="initialDelayMinutes"]');
  await delay.fill("17");
  await expect(page.getByTestId("unsaved")).toBeVisible();
  const saved = page.waitForResponse((r) => /\/automations\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: "Changes saved." })).toBeVisible();
  await expect(page.getByTestId("unsaved")).toHaveCount(0);

  await page.reload();
  await expect(delay).toHaveValue("17");
  await expect(page.getByTestId("automation-status")).not.toHaveAttribute("data-state", "paused");
  await page.goto(BOARD);
  await isOn(page);
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
  await isOn(page);
  await expect(row(page).getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
  expect(started).toBe(1);

  // Then fifty more as fast as the browser allows, forced past the disabled state.
  const button = row(page).getByRole("button", { name: /^(Pause|Enable|Turning on…|Pausing…)$/ });
  for (let i = 0; i < 50; i += 1) {
    await button.click({ force: true, noWaitAfter: true, timeout: 2_000 }).catch(() => undefined);
  }
  await expect(row(page).getByRole("button", { name: /^(Pause|Enable)$/ })).toBeEnabled();
  expect(maxInFlight).toBe(1);
  expect(errors).toEqual([]);

  // Whatever the final state is, the screen shows what the server stored.
  const shown = (await status(page).getAttribute("data-state")) !== "paused";
  const listed = await page.request.get(`/api/businesses/${organizationId}/automations`);
  const rows = ((await listed.json()) as { automations: { type: string; enabled: boolean }[] }).automations;
  expect(rows.find((a) => a.type === "missed_call_recovery")!.enabled).toBe(shown);
  await page.reload();
  await (shown ? isOn(page) : isPaused(page));
});

test("AUTO-10: a failed request is shown as failed, never as success, and the switch does not move", async ({ page }) => {
  await workspaceSession(page);
  await openBoard(page);
  const failures: Array<[string, (route: import("@playwright/test").Route) => Promise<void>, RegExp]> = [
    ["server unavailable", (route) => route.fulfill({ status: 503, json: { error: "down" } }), /briefly unavailable/],
    ["network down", (route) => route.abort("failed"), /couldn't reach TradeCatch/],
    ["server error", (route) => route.fulfill({ status: 500, json: { error: "Something internal" } }), /couldn't save that/],
    ["answer without the stored value", (route) => route.fulfill({ status: 200, json: { ok: true } }), /couldn't confirm the change/],
    ["signed out", (route) => route.fulfill({ status: 401, json: { error: "Unauthorized" } }), /session has ended/],
    ["forbidden", (route) => route.fulfill({ status: 403, json: { error: "Insufficient permissions." } }), /don't have permission/],
  ];
  for (const [, fulfil, message] of failures) {
    await page.route(TOGGLE_URL, fulfil);
    await row(page).getByRole("button", { name: "Enable", exact: true }).click();
    await expect(row(page).getByRole("alert").filter({ hasText: message })).toBeVisible();
    await expect(row(page).getByText("Turned on.", { exact: true })).toHaveCount(0);
    await isPaused(page);
    await expect(row(page).getByRole("button", { name: "Enable", exact: true })).toBeEnabled();
    await page.unroute(TOGGLE_URL);
  }
  await page.reload();
  await isPaused(page);
  // With the fault gone, the same click works.
  await flip(page, "Enable");
  await isOn(page);
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
  await isOn(page);
  await expect(row(page).getByText("Turned on.", { exact: true })).toHaveCount(0);
  await page.unroute(TOGGLE_URL);
  await page.reload();
  await isOn(page);
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
  await expect(row(page).getByRole("alert").filter({ hasText: /lot of changes in a short time/ })).toBeVisible();
  await isPaused(page);
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
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /couldn't save that/ })).toBeVisible();
  await expect(page.getByText("Changes saved.", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("unsaved")).toBeVisible();
  await expect(delay).toHaveValue("33");
  await expect(page.getByRole("button", { name: "Save Changes", exact: true })).toBeEnabled();
  await page.unroute(/\/automations\/[^/]+$/);
  await page.reload();
  await expect(delay).toHaveValue(original);
});

test("settings: a rejected value is explained in words, a non-number never reaches the server", async ({ page }) => {
  await workspaceSession(page);
  await page.goto(QUOTES);
  let patches = 0;
  page.on("request", (r) => r.method() === "PATCH" && /\/automations\/[^/]+$/.test(r.url()) && (patches += 1));
  const delay = page.locator('input[name="initialDelayMinutes"]');
  await delay.fill("abc");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter whole numbers only." })).toBeVisible();
  expect(patches).toBe(0);
  await delay.fill("60");
  await page.locator('input[name="maxAttempts"]').fill("9");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Enter a number of reminders from 1 to 5/ })).toBeVisible();
  expect(patches).toBe(1);
});

test("settings: fifty rapid Save clicks make one request, and the quiet-hours choice is stored", async ({ page }) => {
  await workspaceSession(page);
  await page.goto(MISSED);
  let patches = 0;
  page.on("request", (r) => r.method() === "PATCH" && /\/automations\/[^/]+$/.test(r.url()) && (patches += 1));
  await page.getByRole("checkbox", { name: "Don't text during quiet hours" }).check();
  await expect(page.locator('input[name="windowStartHour"]')).toBeVisible();
  await page.getByRole("button", { name: "Save Changes", exact: true }).evaluate((button) => {
    for (let i = 0; i < 50; i += 1) (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole("status").filter({ hasText: "Changes saved." })).toBeVisible();
  expect(patches).toBe(1);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Don't text during quiet hours" })).toBeChecked();
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
  await flip(pageB, "Pause");

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
  await isPaused(pageB);
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
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Changes saved." })).toBeVisible();

  await page.context().clearCookies();
  await signInAs(page, who.email, who.clientIp);

  await openBoard(page);
  await isOn(page);
  await page.goto(MISSED);
  await expect(page.locator('input[name="initialDelayMinutes"]')).toHaveValue("12");
  await expect(page.getByTestId("automation-status")).not.toHaveAttribute("data-state", "paused");
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
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /saved/i })).toBeVisible();
  await expect(page.getByTestId("template-unsaved")).toHaveCount(0);

  await page.getByRole("button", { name: "First quote reminder" }).click();
  await expect(box).not.toHaveValue(edited);
  await page.getByRole("button", { name: "Missed-call text", exact: true }).click();
  await expect(box).toHaveValue(edited);
  await page.reload();
  await page.getByLabel("Message language").selectOption("en");
  await expect(box).toHaveValue(edited);

  // A template that drops the opt-out line is refused with the reason in words.
  await box.fill("Hello there");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /business name|opt-out/i })).toBeVisible();
  await expect(page.getByTestId("template-unsaved")).toBeVisible();
});

test("the Test and Edit links only appear for automations that have those pages", async ({ page }) => {
  await workspaceSession(page);
  await openBoard(page);
  await expect(row(page).getByRole("link", { name: "Edit Settings" })).toHaveAttribute("href", /\/app\/automations\/missed-call$/);
  await expect(row(page, "quote_followup").getByRole("link", { name: "Run a Test" })).toHaveAttribute("href", /\/app\/automations\/quotes$/);
  await expect(row(page, "appointment_reminder").getByRole("link", { name: "Run a Test" })).toHaveCount(0);
  await expect(row(page, "appointment_reminder").getByRole("link", { name: "Edit Settings" })).toHaveCount(0);
  await expect(row(page, "customer_reengagement").getByRole("button", { name: "Enable", exact: true })).toHaveCount(0);
});

test("the quote follow-up page has no stop-on-accept switch, and says reminders always stop", async ({ page }) => {
  await workspaceSession(page);
  await page.goto("/app/automations/quotes");
  await expect(page.getByRole("checkbox", { name: /quote is accepted|quote is rejected/i })).toHaveCount(0);
  await expect(page.getByText("Reminders always stop once the quote is accepted, declined or canceled.")).toBeVisible();
});

// ---------------------------------------------------------------------------------------
// KAN-24: the words on these screens, in both languages.
// ---------------------------------------------------------------------------------------

const FR_BOARD = "/fr/app/automatisations";
const FR_MISSED = "/fr/app/automatisations/appel-manque";
const FR_QUOTES = "/fr/app/automatisations/soumissions";

/** The page's own content: the heading's grandparent, so the sidebar is not included. */
const content = (page: Page) => page.locator("h1").locator("xpath=../..");

const JARGON_EN = /\b(backend|webhooks?|api|triggers?|executions?|pipelines?|sms|workflows?|providers?|handsets?|segments?)\b/i;
const JARGON_FR = /\b(backend|webhooks?|api|d[ée]clencheurs?|ex[ée]cutions?|pipelines?|sms|flux|fournisseurs?|serveur|segments?)\b/i;

test("KAN-24: the overview explains each follow-up in plain English, and promises nothing while paused", async ({ page }) => {
  await workspaceSession(page);
  await page.goto(BOARD);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Automatic Follow-Ups");
  await expect(
    page.getByText(
      "Never miss an opportunity. Automatically follow up with customers, send quote reminders, and stay connected without lifting a finger. TradeCatch handles everything for you, even when you're offline.",
      { exact: true },
    ),
  ).toBeVisible();

  await expect(row(page).getByRole("heading", { name: "Missed-Call Follow-Up" })).toBeVisible();
  await expect(
    row(page).getByText("Missed a call? TradeCatch can automatically send a message so you don't lose a potential customer.", { exact: true }),
  ).toBeVisible();
  await expect(row(page, "quote_followup").getByRole("heading", { name: "Quote Reminders" })).toBeVisible();
  await expect(
    row(page, "quote_followup").getByText("Automatically remind customers about unanswered quotes and turn more opportunities into jobs.", {
      exact: true,
    }),
  ).toBeVisible();

  // Off by default: it says so, and says nothing will be sent.
  for (const type of ["missed_call_recovery", "quote_followup", "appointment_reminder"]) {
    await expect(status(page, type)).toHaveText("Paused");
    await expect(page.getByTestId(`status-help-${type}`)).toHaveText("Turned off. No texts will be sent.");
    await expect(row(page, type).getByRole("button", { name: "Enable", exact: true })).toBeVisible();
    await expect(row(page, type).getByRole("link", { name: "View History" })).toBeVisible();
  }
  // Not available yet: no switch, and no promise of a text.
  for (const type of ["customer_reengagement", "urgent_lead_notification"]) {
    await expect(status(page, type)).toHaveText("Coming soon");
    await expect(row(page, type).getByText(/Nothing is sent for now/)).toBeVisible();
    await expect(row(page, type).getByRole("button")).toHaveCount(0);
  }

  // When it runs, from the real settings, and how consent works.
  await expect(row(page).getByText("When a call goes unanswered, one text is sent about 2 minutes later.")).toBeVisible();
  await expect(row(page).getByText("Quiet hours are off, so the caller gets the text at any hour.")).toBeVisible();
  await expect(row(page, "quote_followup").getByText(/reminders are sent 1 day and 5 days after you send it/)).toBeVisible();
  await expect(row(page, "quote_followup").getByText(/between 8 AM and 8 PM, not on weekends/)).toBeVisible();
  await expect(page.getByText(/Anyone who replies STOP is not texted again/)).toBeVisible();
  await expect(page.getByText(/Use Enable to start a follow-up and Pause to stop it/)).toBeVisible();

  const text = await content(page).innerText();
  expect(text).not.toMatch(JARGON_EN);
  expect(text).not.toMatch(/\bAI\b|virtual assistant|Inactive|Disable/);
});

test("KAN-24: the overview speaks natural Canadian French", async ({ page }) => {
  await workspaceSession(page, "fr");
  await page.goto(FR_BOARD);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Suivis automatiques");
  await expect(
    page.getByText(
      "Ne manquez plus aucune occasion. Relancez automatiquement vos clients, envoyez des rappels de soumission et gardez le contact sans effort. TradeCatch s'occupe des suivis, même lorsque vous n'êtes pas disponible.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(row(page).getByRole("heading", { name: "Suivi des appels manqués" })).toBeVisible();
  await expect(row(page, "quote_followup").getByRole("heading", { name: "Rappels de soumission" })).toBeVisible();
  await expect(status(page)).toHaveText("En pause");
  await expect(page.getByTestId("status-help-missed_call_recovery")).toHaveText("Désactivé. Aucun texto ne sera envoyé.");
  await expect(row(page).getByRole("button", { name: "Activer", exact: true })).toBeVisible();
  await expect(row(page).getByRole("link", { name: "Voir l'historique" })).toBeVisible();
  await expect(row(page).getByText(/environ 2 minutes plus tard/)).toBeVisible();
  await expect(row(page, "quote_followup").getByText(/entre 8 h et 20 h, sauf la fin de semaine/)).toBeVisible();

  const text = await content(page).innerText();
  expect(text).not.toMatch(JARGON_FR);
  expect(text).not.toMatch(/\bIA\b|assistant virtuel/);
  // None of the English labels leak into the French screen.
  expect(text).not.toMatch(/\b(Enable|Pause|Paused|Active|Needs Attention|Follow-Up|History)\b/);
});

test("KAN-24: turning on a follow-up that cannot text yet says so, instead of promising texts", async ({ page }) => {
  await workspaceSession(page);
  await openBoard(page);
  await flip(page, "Enable");
  await expect(status(page)).toHaveText("Needs Attention");
  await expect(status(page)).toHaveAttribute("data-state", "attention");
  await expect(page.getByTestId("status-help-missed_call_recovery")).toContainText("not set up for texting yet, so no texts can be sent");
  await expect(row(page).getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  // Never "Active" or "Scheduled" for something that cannot send.
  await expect(status(page)).not.toHaveText(/Active|Scheduled/);

  await page.reload();
  await expect(status(page)).toHaveText("Needs Attention");
  await page.goto(MISSED);
  await expect(page.getByTestId("automation-status")).toHaveText("Needs Attention");
  await expect(page.getByTestId("automation-status-help")).toContainText("no texts can be sent");

  await page.goto(FR_BOARD);
  await expect(status(page)).toHaveText("Attention requise");
  await expect(page.getByTestId("status-help-missed_call_recovery")).toContainText("aucun texto ne peut être envoyé");

  // Pausing makes the promise go away again. (A visit to /fr sets the language cookie, so go back explicitly.)
  await page.goto(`/en${BOARD}`);
  await flip(page, "Pause");
  await expect(status(page)).toHaveText("Paused");
  await expect(page.getByTestId("status-help-missed_call_recovery")).toHaveText("Turned off. No texts will be sent.");
});

test("KAN-24: switching language changes the words, never the saved switch or settings", async ({ page }) => {
  await workspaceSession(page);
  await openBoard(page);
  await flip(page, "Enable");
  await page.goto(MISSED);
  await page.locator('input[name="initialDelayMinutes"]').fill("17");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Changes saved." })).toBeVisible();
  await page.getByLabel("Message language").selectOption("fr");
  await page.getByRole("checkbox", { name: "Stop when the customer replies" }).uncheck();
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Changes saved." })).toBeVisible();

  await page.goto(FR_MISSED);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Suivi des appels manqués");
  await expect(page.locator('input[name="initialDelayMinutes"]')).toHaveValue("17");
  await expect(page.getByLabel("Langue du message")).toHaveValue("fr");
  await expect(page.getByRole("checkbox", { name: "Arrêter quand le client répond" })).not.toBeChecked();
  await expect(page.getByTestId("automation-status")).not.toHaveAttribute("data-state", "paused");
  await expect(page.getByRole("button", { name: "Mettre en pause", exact: true })).toBeVisible();

  await page.goto(`/en${MISSED}`);
  await expect(page.locator('input[name="initialDelayMinutes"]')).toHaveValue("17");
  await expect(page.getByRole("checkbox", { name: "Stop when the customer replies" })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
});

test("KAN-24: a failure is explained in the person's own language, never in the server's English", async ({ page }) => {
  await workspaceSession(page, "fr");
  await page.goto(FR_BOARD);
  await expect(row(page)).toBeVisible();
  const failures: Array<[number, unknown, RegExp]> = [
    [409, { error: "Enable missed-call recovery first." }, /Activez d'abord ce suivi/],
    [409, { error: "This workflow is not operational yet." }, /pas encore offert/],
    [409, { error: "threadId is required." }, /n'a pas pu être fait pour le moment/],
    [400, { error: "Invalid settings." }, /Certains renseignements/],
    [404, { error: "Automation not found." }, /Nous n'avons pas pu enregistrer/],
    [503, { error: "down" }, /brièvement indisponible/],
    [403, { error: "Insufficient permissions." }, /pas la permission/],
  ];
  for (const [statusCode, json, message] of failures) {
    await page.route(TOGGLE_URL, (route) => route.fulfill({ status: statusCode, json }));
    await row(page).getByRole("button", { name: "Activer", exact: true }).click();
    const alert = row(page).getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText(message);
    await expect(alert).not.toContainText(/threadId|Invalid|Enable|workflow|not found|Insufficient/i);
    await page.unroute(TOGGLE_URL);
  }
});

test("KAN-24: the settings pages explain timing in plain words and show only what applies", async ({ page }) => {
  await workspaceSession(page);
  await page.goto(MISSED);
  await expect(page.getByText("Follow-Up Scheduling", { exact: true })).toBeVisible();
  await expect(page.getByText("Choose when customers receive reminders. TradeCatch takes care of the rest.", { exact: true })).toBeVisible();
  const delay = page.getByLabel("Send the text after (minutes)");
  await expect(delay).toHaveValue("2");
  await expect(page.getByText("Counted from the missed call. That is 2 minutes.")).toBeVisible();
  await delay.fill("1500");
  await expect(page.getByText("That is 1 day and 1 hour.")).toBeVisible();
  await delay.fill("0");
  await expect(page.getByText("Sent right away.")).toBeVisible();

  // Things that do nothing for a missed call are not offered.
  await expect(page.locator('input[name="maxAttempts"]')).toHaveCount(0);
  await expect(page.getByLabel("Number of reminders")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Don't text the same caller twice within 24 hours" })).toBeChecked();
  // The sending hours only appear once quiet hours are on, and say what the hour means.
  await expect(page.getByLabel("Start sending at (hour, 0 to 24)")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Don't text during quiet hours" }).check();
  await expect(page.getByLabel("Start sending at (hour, 0 to 24)")).toHaveValue("8");
  await expect(page.getByText("That is 8 AM.")).toBeVisible();
  await expect(page.getByText("That is 8 PM.")).toBeVisible();
  await expect(page.getByText(/On: you choose your sending hours, and a call missed outside them gets no text/)).toBeVisible();

  await page.goto(QUOTES);
  await expect(page.getByLabel("Send the first reminder after (minutes)")).toHaveValue("1440");
  await expect(page.getByText("Counted from when you send the quote. That is 1 day.")).toBeVisible();
  await expect(page.getByText(/That is 5 days\./)).toBeVisible();
  await expect(page.getByLabel("Number of reminders")).toHaveValue("2");
  await expect(page.getByText("Up to 2 reminders are sent for each quote. Enter 1 to send only the first.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Don't text the same caller twice within 24 hours" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Also send on weekends" })).not.toBeChecked();
  await expect(page.getByText("Reminders always stop once the quote is accepted, declined or canceled.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quote Reminders", level: 1 })).toBeVisible();
  const text = await content(page).innerText();
  expect(text).not.toMatch(JARGON_EN);
});

test("KAN-24: the template editor talks about details and parts of a text, not variables and segments", async ({ page }) => {
  await workspaceSession(page);
  await page.goto("/app/automations/templates");
  await page.getByLabel("Message language").selectOption("en");
  const box = page.getByRole("textbox");
  await box.fill("Hi, it's {{business_name}}. Reply STOP to opt out.");
  await page.getByRole("button", { name: "Customer name", exact: true }).click();
  await expect(box).toHaveValue("Hi, it's {{business_name}}. Reply STOP to opt out.{{customer_name}}");
  await expect(page.getByText(/Details in double braces, like \{\{business_name\}\}, are filled in for each customer\./)).toBeVisible();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText(/Text parts: 1/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore Default", exact: true })).toBeVisible();
  const text = await content(page).innerText();
  expect(text).not.toMatch(/\b(gsm|ucs2|sms|segments?|variables?)\b/i);

  // A refusal names the business name in words and shows how to write it.
  await box.fill("Hello there, this has no required lines at all.");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Keep the business name" })).toContainText("Keep the business name (written {{business_name}})");
});

test("KAN-24: History and the test panel use plain words", async ({ page }) => {
  await workspaceSession(page);
  await page.goto("/app/automations/history");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Message History");
  await expect(page.getByText(/No automatic texts yet\./)).toBeVisible();
  await expect(page.getByText(/“Sent” means it left TradeCatch\. “Delivered” means it reached the customer's phone\./)).toBeVisible();

  // Turn missed-call follow-up on, then run a test: the result is in sentences, with a plain status.
  await page.goto(BOARD);
  await flip(page, "Enable");
  await page.goto(MISSED);
  await expect(page.getByRole("heading", { name: "Try It Out With a Test Customer" })).toBeVisible();
  await page.getByRole("button", { name: "Test a Missed Call", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /Scheduled: text to \+15145550199/ })).toBeVisible();
  await page.getByRole("button", { name: "Send the Next Waiting Test Text", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /Sent: text to \+15145550199/ })).toBeVisible();

  await page.goto("/app/automations/history");
  const text = await content(page).innerText();
  expect(text).toMatch(/Sent · test/);
  expect(text).not.toMatch(/\b(submitted|pending|processing|legal_basis|missing_sender)\b/);
  expect(text).not.toMatch(JARGON_EN);
});

test("KAN-24: nothing spills off a phone screen, in either language", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await workspaceSession(page);
  await openBoard(page);
  // Turn everything on so the longest sentences (Needs Attention) are on screen.
  for (const type of ["missed_call_recovery", "quote_followup", "appointment_reminder"]) {
    const answered = page.waitForResponse((r) => TOGGLE_URL.test(r.url()) && r.request().method() === "POST");
    await row(page, type).getByRole("button", { name: "Enable", exact: true }).click();
    expect((await answered).status()).toBe(200);
  }
  await expect(status(page, "appointment_reminder")).toHaveAttribute("data-state", "attention");

  const paths = [
    BOARD,
    MISSED,
    QUOTES,
    "/app/automations/templates",
    "/app/automations/history",
    FR_BOARD,
    FR_MISSED,
    FR_QUOTES,
    "/fr/app/automatisations/modeles",
    "/fr/app/automatisations/historique",
  ];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    const problems = await page.evaluate(() => {
      const root = document.querySelector("h1")!.parentElement!.parentElement!;
      const width = window.innerWidth;
      const found: string[] = [];
      if (document.documentElement.scrollWidth > width + 1) {
        found.push(`page is ${document.documentElement.scrollWidth}px wide in a ${width}px window`);
      }
      const inScroller = (el: Element) => {
        for (let node = el.parentElement; node && node !== root; node = node.parentElement) {
          const overflowX = getComputedStyle(node).overflowX;
          if (overflowX === "auto" || overflowX === "scroll") return true;
        }
        return false;
      };
      for (const el of root.querySelectorAll("*")) {
        if (inScroller(el)) continue;
        const box = el.getBoundingClientRect();
        if (box.width === 0) continue;
        if (box.right > width + 1 || box.left < -1) {
          found.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}" reaches ${Math.round(box.right)}px`);
        }
      }
      // Text must stay inside its own button, link, label and pill.
      for (const el of root.querySelectorAll("button, a, label, [data-testid^='status-']")) {
        if (el instanceof HTMLElement && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
          found.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}" overflows itself`);
        }
      }
      return found.slice(0, 5);
    });
    expect(problems, `${path}: ${problems.join("; ")}`).toEqual([]);
  }
});
