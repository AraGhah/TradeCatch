import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import { ADMINS, adminSession, freshIp, opsHeaders } from "./support/admin-session";

// Same reasoning as tests/admin-dashboard.spec.ts: pages are rendered on demand and a busy machine
// makes the 5 s default tight. These tests check behavior, not speed.
const expect = baseExpect.configure({ timeout: 15_000 });

/**
 * KAN-28 browser acceptance for the administrator's System Health view.
 *
 *  MON-13 unauthorized monitoring access is denied, by credentials and by role
 *  MON-14 the admin opens System Health and sees accurate, live data: never a
 *         simulated reading, and never "healthy" for something nobody measured
 *  MON-15 nothing sensitive reaches the page
 *
 * The e2e server has no database, no Twilio/Stripe/Resend and no public address,
 * so the monitor can measure almost nothing here. That is the point of the first
 * test: the console must say "not measured" rather than invent a healthy reading.
 * How the page words a *measured* area (healthy, degraded, incident) is pinned by
 * the "UI contract" test, which edits a real response; the derivation behind it is
 * proven in tests/unit/monitoring-health.test.ts.
 *
 * The tests here share one server and one incident (every simulated database
 * failure has the same fingerprint, so it is one incident), so they run in order,
 * and each one first puts that incident in the state it needs.
 */
test.describe.configure({ mode: "serial" });

const h1 = (page: Page) => page.getByRole("heading", { level: 1 });
const AREA_NAMES = ["Website", "API", "Voice receptionist", "SMS", "Stripe billing", "Database", "Calendar", "Automations"];
const INCIDENT_TITLE = "Database: DATABASE_UNAVAILABLE";
// Role identities reserved for this file in playwright.config.ts.
const MON_SUPPORT = "adm-mon-support@example.test";
const MON_READ_ONLY = "adm-mon-readonly@example.test";

type Incident = { id: string; title: string; status: string };
type HealthBody = {
  incidents: Incident[];
  monitor: { state: string; lastRunAt: string | null; ageMs: number | null; website: string; database: string; degraded: string[] };
  areas: Array<{ key: string; state: string; reason: string | null; activeIncidents: number; highest: string | null; detail: string; checkedAt: string | null }>;
};

async function simulateDatabaseFailure(page: Page) {
  const response = await page.request.post("/api/admin/monitoring/test", {
    data: { scenario: "database_failure" },
    headers: { "x-forwarded-for": freshIp() },
  });
  expect(response.status()).toBe(200);
}

async function activeIncident(page: Page): Promise<Incident | undefined> {
  const health = (await (await page.request.get("/api/admin/health")).json()) as HealthBody;
  return health.incidents.find((incident) => incident.title === INCIDENT_TITLE && incident.status !== "resolved");
}

/** An incident that is Active (neither acknowledged nor resolved), whatever an earlier test left behind. */
async function openIncident(page: Page): Promise<string> {
  await simulateDatabaseFailure(page);
  let incident = await activeIncident(page);
  if (incident && incident.status !== "open") {
    // Acknowledged by an earlier test: close it, then let the same failure open it again.
    const closed = await page.request.post(`/api/admin/incidents/${incident.id}/resolve`, { data: {}, headers: { "x-forwarded-for": freshIp() } });
    expect(closed.status()).toBe(200);
    await simulateDatabaseFailure(page);
    incident = await activeIncident(page);
  }
  expect(incident, "an active incident exists").toBeTruthy();
  expect(incident!.status).toBe("open");
  return incident!.id;
}

/** Serves the real System Health response with `patch` applied, so wording can be checked for states the harness cannot produce. */
async function patchHealth(page: Page, patch: (body: HealthBody) => void) {
  await page.route("**/api/admin/health**", async (route) => {
    const real = await route.fetch();
    const body = (await real.json()) as HealthBody;
    patch(body);
    await route.fulfill({
      status: real.status(),
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: JSON.stringify(body),
    });
  });
}

async function otherAdmin(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await adminSession(page, email);
  return { context, page };
}

const seriousViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.nodes[0]?.html}`);
};

test("MON-14 System Health lists every area, and never calls an unmeasured one healthy", async ({ page }) => {
  await adminSession(page, ADMINS.super("21"));
  await page.goto("/admin/system-health");
  await expect(h1(page)).toHaveText("System health");

  const areas = page.getByRole("region", { name: "Areas", exact: true });
  await expect(areas.locator("[data-area]")).toHaveCount(AREA_NAMES.length);
  for (const name of AREA_NAMES) await expect(areas.getByText(name, { exact: true })).toBeVisible();

  // Nothing here can be measured, so nothing may be called healthy, whether or not the monitor has run yet.
  await expect(areas.locator('[data-state="healthy"]')).toHaveCount(0);
  await expect(areas.locator('[data-state="unknown"]')).toHaveCount(AREA_NAMES.length);

  // One real monitor run (the same call the Cloudflare cron makes every minute).
  const run = await page.request.post("/api/monitoring/watch", { headers: { ...opsHeaders(), "x-forwarded-for": freshIp() } });
  expect(run.status()).toBe(200);
  expect((await run.json()).ok).toBe(true);

  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText(/^Monitor last ran /)).toBeVisible();
  await expect(page.getByText(/The monitor has not run yet\. Nothing below/)).toBeHidden();

  // This server has no public address, no database and no data to read: each area says exactly what it could not measure.
  await expect(areas.locator('[data-area="website"]')).toContainText("No public address is configured to check.");
  await expect(areas.locator('[data-area="database"]')).toContainText("No database is configured to check.");
  await expect(areas.locator('[data-area="stripe"]')).toContainText("The data for this check could not be read.");
  await expect(areas.locator('[data-state="healthy"]')).toHaveCount(0);

  // The alert-email panel reads real delivery state and has nothing to report yet.
  const alerts = page.getByRole("region", { name: "Alert emails", exact: true });
  await expect(alerts).toContainText("No failed alert emails.");
  await expect(alerts.getByText("Waiting to send")).toBeVisible();

  // Nothing sensitive reaches the page or the API behind it (MON-15).
  const health = JSON.stringify(await (await page.request.get("/api/admin/health")).json());
  expect(health).not.toMatch(/sk_(live|test)_|whsec_|Bearer\s|\b\d{13,19}\b|@example\.test/);
});

test("MON-14 the page words every monitor and area state (UI contract)", async ({ page }) => {
  await adminSession(page, ADMINS.super("31"));
  let mode: "never" | "stale" | "measured" = "never";
  await patchHealth(page, (body) => {
    if (mode === "never") {
      body.monitor = { state: "never", lastRunAt: null, ageMs: null, website: "not_measured", database: "not_measured", degraded: [] };
      for (const area of body.areas) Object.assign(area, { state: "unknown", reason: "monitor_never", activeIncidents: 0, highest: null, checkedAt: null });
    } else if (mode === "stale") {
      body.monitor = { state: "stale", lastRunAt: new Date(Date.now() - 600_000).toISOString(), ageMs: 600_000, website: "ok", database: "ok", degraded: [] };
      for (const area of body.areas) Object.assign(area, { state: "unknown", reason: "monitor_stale", activeIncidents: 0, highest: null, checkedAt: null });
    } else {
      body.monitor = { state: "running", lastRunAt: new Date().toISOString(), ageMs: 90_000, website: "ok", database: "ok", degraded: ["stripe_billing"] };
      const set = (key: string, change: Partial<HealthBody["areas"][number]>) => Object.assign(body.areas.find((area) => area.key === key)!, change);
      for (const area of body.areas) Object.assign(area, { state: "healthy", reason: null, activeIncidents: 0, highest: null, checkedAt: body.monitor.lastRunAt });
      set("sms", { state: "incident", activeIncidents: 2, highest: "high" });
      set("database", { state: "degraded", activeIncidents: 1, highest: "warning" });
      set("api", { state: "degraded" });
      set("stripe", { state: "unknown", reason: "data_unreadable", checkedAt: null });
    }
  });

  await page.goto("/admin/system-health");
  const areas = page.getByRole("region", { name: "Areas", exact: true });
  const card = (key: string) => areas.locator(`[data-area="${key}"]`);

  // Never run: said once, loudly, and no area claims to be healthy.
  await expect(page.getByText(/The monitor has not run yet\. Nothing below/)).toBeVisible();
  await expect(areas.locator('[data-state="unknown"]')).toHaveCount(AREA_NAMES.length);
  await expect(card("sms")).toContainText("The monitor has not run yet.");

  // Stopped: the age is shown, and areas fall back to "not measured".
  mode = "stale";
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("The monitor last ran 10 min ago.", { exact: false })).toBeVisible();
  await expect(card("website")).toContainText("The monitor has not run recently.");

  // Running: each state is worded for what it means.
  mode = "measured";
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Monitor last ran 1 min ago.")).toBeVisible();
  await expect(card("website")).toContainText("Healthy");
  await expect(card("website")).toContainText("No active incidents.");
  await expect(card("sms")).toContainText("Incident");
  await expect(card("sms")).toContainText("2 active incidents");
  await expect(card("database")).toContainText("Degraded");
  await expect(card("database")).toContainText("1 active warning");
  await expect(card("api")).toContainText("A recent check found a problem.");
  await expect(card("stripe")).toContainText("Not measured");
  await expect(card("stripe")).toContainText("The data for this check could not be read.");
  await expect(card("sms")).toHaveAttribute("data-state", "incident");
  await expect(card("website")).toHaveAttribute("data-state", "healthy");
  expect(await seriousViolations(page)).toEqual([]);
});

test("MON-14 an incident can be opened, acknowledged and resolved, with its history", async ({ page }) => {
  const admin = await adminSession(page, ADMINS.super("22"));
  await openIncident(page);
  await page.goto("/admin/system-health");

  const table = page.getByRole("table", { name: "Incidents" });
  const row = table.getByRole("row").filter({ hasText: INCIDENT_TITLE });
  await expect(row).toContainText("Critical");
  await expect(row).toContainText("Active");

  // A simulated incident is shown for what it is, and does not make the real area look broken.
  await expect(page.locator('[data-area="database"]')).not.toHaveAttribute("data-state", "incident");

  await row.getByRole("button", { name: INCIDENT_TITLE }).click();
  const detail = page.getByRole("region", { name: INCIDENT_TITLE, exact: true });
  await expect(detail).toBeVisible();
  await expect(detail.getByText(/Simulated/).first()).toBeVisible();
  await expect(detail.getByRole("heading", { name: "History" })).toBeVisible();
  await expect(detail.getByText("Opened", { exact: true })).toBeVisible();
  // The diagnostic reference is shown so an administrator can find the matching log lines.
  await expect(detail.getByText("Diagnostic reference")).toBeVisible();

  await detail.getByRole("button", { name: "Acknowledge" }).click();
  await expect(detail.getByRole("button", { name: "Acknowledge", exact: true })).toBeHidden();
  await expect(row).toContainText("Acknowledged");
  // It records who did it, in the history and in the facts.
  await expect(detail.getByRole("listitem").filter({ hasText: new RegExp(`Acknowledged.*${admin.email}`) })).toHaveCount(1);
  await expect(detail.getByText("Acknowledged by")).toBeVisible();

  // Resolving asks first, and an incident that is still happening would simply reopen.
  await detail.getByRole("button", { name: "Mark resolved" }).click();
  await expect(detail.getByText("Mark this incident resolved?")).toBeVisible();
  await detail.getByRole("button", { name: "Cancel" }).click();
  await expect(row).toContainText("Acknowledged");
  await detail.getByRole("button", { name: "Mark resolved" }).click();
  await detail.getByRole("form").getByRole("button", { name: "Mark resolved" }).click();
  await expect(row).toContainText("Resolved");
  await expect(detail.getByRole("button", { name: "Mark resolved" })).toBeHidden();

  // The status filter speaks the same words, and a resolved incident is no longer Active.
  await page.locator("#hf-status").selectOption({ label: "Active" });
  await expect(page.getByRole("button", { name: INCIDENT_TITLE })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();

  // No serious accessibility violations with the details open.
  await expect(detail).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("MON-14 the link in an alert email opens that incident, and an unknown one fails gracefully", async ({ page }) => {
  await adminSession(page, ADMINS.super("23"));
  const id = await openIncident(page);

  // The same link the email carries: /admin/system-health?incident=<id>.
  await page.goto(`/admin/system-health?incident=${encodeURIComponent(id)}`);
  const detail = page.getByRole("region", { name: INCIDENT_TITLE, exact: true });
  await expect(detail).toBeVisible();
  // The reference the email calls "Diagnostic reference" is this incident's id: it must be findable here.
  await expect(detail.getByText(id, { exact: true })).toBeVisible();

  await page.goto("/admin/system-health?incident=inc_does_not_exist");
  await expect(page.getByText("The incident details could not be loaded.")).toBeVisible();
  await expect(h1(page)).toHaveText("System health");
  // A malformed value is ignored rather than sent to the server.
  await page.goto(`/admin/system-health?incident=${encodeURIComponent("../../etc/passwd")}`);
  await expect(h1(page)).toHaveText("System health");
  await expect(page.getByText("The incident details could not be loaded.")).toBeHidden();
});

test("MON-13 monitoring data and actions are denied without credentials, and to roles that may not change incidents", async ({ page, browser, request }) => {
  const ip = () => ({ "x-forwarded-for": freshIp() });

  // No credentials at all.
  for (const [method, url] of [
    ["GET", "/api/admin/health"],
    ["GET", "/api/admin/incidents/inc_unknown"],
    ["POST", "/api/admin/incidents/inc_unknown/acknowledge"],
    ["POST", "/api/admin/incidents/inc_unknown/resolve"],
    ["POST", "/api/monitoring/watch"],
    ["POST", "/api/monitoring/ingest"],
  ] as const) {
    const response = await request.fetch(url, { method, headers: ip(), data: method === "POST" ? {} : undefined });
    expect([401, 403], `${method} ${url} -> ${response.status()}`).toContain(response.status());
    expect(await response.text()).not.toMatch(/DATABASE_UNAVAILABLE|incident/i);
  }

  // A wrong secret is no better than none.
  const wrong = await request.post("/api/monitoring/watch", { headers: { ...ip(), Authorization: "Bearer not-the-secret" } });
  expect([401, 403]).toContain(wrong.status());

  // Support and read-only administrators may read incidents, but not change them.
  await adminSession(page, ADMINS.super("33"));
  const id = await openIncident(page);

  for (const email of [MON_SUPPORT, MON_READ_ONLY]) {
    const { context, page: other } = await otherAdmin(browser, email);
    const detail = await other.request.get(`/api/admin/incidents/${id}`, { headers: ip() });
    expect(detail.status(), `${email} may read`).toBe(200);
    for (const action of ["acknowledge", "resolve"]) {
      const response = await other.request.post(`/api/admin/incidents/${id}/${action}`, { headers: ip(), data: {} });
      expect(response.status(), `${email} ${action}`).toBe(403);
    }
    // And the console says so instead of offering a button that fails.
    await other.goto("/admin/system-health");
    await other.getByRole("table", { name: "Incidents" }).getByRole("button", { name: INCIDENT_TITLE }).click();
    const panel = other.getByRole("region", { name: INCIDENT_TITLE, exact: true });
    await expect(panel.getByText("Your role can view incidents but not acknowledge or resolve them.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Acknowledge", exact: true })).toBeDisabled();
    await context.close();
  }

  const after = await (await page.request.get(`/api/admin/incidents/${id}`)).json();
  expect(after.incident.status, "nothing changed").toBe("open");
});

test("System Health is readable in French and usable on a phone", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();
  await adminSession(page, ADMINS.super("34"), "fr");
  await openIncident(page);
  // Whether the monitor has run depends on what ran before; pin it so the wording is what is asserted.
  await patchHealth(page, (body) => {
    body.monitor = { state: "never", lastRunAt: null, ageMs: null, website: "not_measured", database: "not_measured", degraded: [] };
    for (const area of body.areas) Object.assign(area, { state: "unknown", reason: "monitor_never", activeIncidents: 0, highest: null, checkedAt: null });
  });
  await page.goto("/fr/admin/system-health");
  await expect(h1(page)).toHaveText("Santé du système");

  const areas = page.getByRole("region", { name: "Secteurs", exact: true });
  await expect(areas.locator("[data-area]")).toHaveCount(AREA_NAMES.length);
  await expect(areas.getByText("Non mesuré").first()).toBeVisible();
  await expect(page.getByText(/La surveillance ne s’est pas encore exécutée/).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Courriels d’alerte", exact: true })).toBeVisible();

  // Incidents become cards, and the details open without scrolling sideways.
  const list = page.getByRole("list", { name: "Incidents" });
  await list.getByRole("button", { name: INCIDENT_TITLE }).click();
  const detail = page.getByRole("region", { name: INCIDENT_TITLE, exact: true });
  await expect(detail.getByRole("button", { name: "Prendre en compte" })).toBeVisible();
  await expect(detail.getByText(/Critique/).first()).toBeVisible();
  await expect(detail.getByText(/Actif/).first()).toBeVisible();
  const acknowledge = await detail.getByRole("button", { name: "Prendre en compte" }).boundingBox();
  expect(acknowledge?.height ?? 0, "touch target height").toBeGreaterThanOrEqual(40);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
  expect(await seriousViolations(page)).toEqual([]);
  await context.close();
});
