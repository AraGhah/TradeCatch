import { expect, test, type Page } from "@playwright/test";
import { signInAs, workspaceSession } from "./support/workspace-session";

/**
 * The Privacy settings page against the real API (in-memory stores in the E2E
 * harness): what the page shows is what the server stored, after a reload and
 * after signing in again; a failed save is shown as failed; one business
 * cannot change another's settings.
 */
const PATH = "/app/receptionist/privacy";

const TOGGLES = [
  { name: "Record voicemails", field: "callRecordingEnabled", initial: false },
  { name: "Keep call transcripts", field: "saveCallTranscripts", initial: true },
  { name: "Keep text message history", field: "saveSmsHistory", initial: true },
] as const;

async function openPrivacy(page: Page) {
  const loaded = page.waitForResponse(
    (r) => /\/api\/businesses\/[^/]+\/privacy$/.test(r.url()) && r.request().method() === "GET",
  );
  await page.goto(PATH);
  const response = await loaded;
  expect(response.status()).toBe(200);
  const organizationId = response.url().match(/businesses\/([^/]+)\/privacy/)![1]!;
  await expect(page.getByRole("button", { name: "Save privacy settings" })).toBeVisible();
  return organizationId;
}

async function saveAndConfirm(page: Page) {
  const saved = page.waitForResponse(
    (r) => /\/privacy$/.test(r.url()) && r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save privacy settings" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: "Privacy settings saved." })).toBeVisible();
}

test("loads the business's real values: privacy-preserving defaults for a new business", async ({ page }) => {
  await workspaceSession(page);
  await openPrivacy(page);
  for (const toggle of TOGGLES)
    await expect(page.getByRole("checkbox", { name: toggle.name })).toBeChecked({ checked: toggle.initial });
  await expect(page.getByLabel("Keep call and message content for")).toHaveValue("90");
  // Analytics are not configured in this harness, so no switch is offered for them.
  await expect(page.getByText("TradeCatch does not run usage analytics in your dashboard")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /analytics/i })).toHaveCount(0);
});

for (const toggle of TOGGLES) {
  test(`${toggle.field}: change → save → reload keeps it; change back → save → sign in again keeps it`, async ({ page }) => {
    const who = await workspaceSession(page);
    await openPrivacy(page);
    const box = () => page.getByRole("checkbox", { name: toggle.name });
    await box().setChecked(!toggle.initial);
    await expect(page.getByTestId(`unsaved-${toggle.field}`)).toBeVisible();
    await saveAndConfirm(page);
    await expect(page.getByTestId(`unsaved-${toggle.field}`)).toHaveCount(0);

    await page.reload();
    await openPrivacy(page);
    await expect(box()).toBeChecked({ checked: !toggle.initial });

    await box().setChecked(toggle.initial);
    await saveAndConfirm(page);
    await page.context().clearCookies();
    await signInAs(page, who.email, who.clientIp);
    await openPrivacy(page);
    await expect(box()).toBeChecked({ checked: toggle.initial });
  });
}

test("customerDataRetentionDays: 180 → save → reload; 30 → save → sign in again", async ({ page }) => {
  const who = await workspaceSession(page);
  await openPrivacy(page);
  const select = () => page.getByLabel("Keep call and message content for");
  await select().selectOption("180");
  await saveAndConfirm(page);
  await page.reload();
  await openPrivacy(page);
  await expect(select()).toHaveValue("180");
  await select().selectOption("30");
  await saveAndConfirm(page);
  await page.context().clearCookies();
  await signInAs(page, who.email, who.clientIp);
  await openPrivacy(page);
  await expect(select()).toHaveValue("30");
});

test("a failed save shows an error, never success, marks the value unsaved, and nothing is stored", async ({ page }) => {
  await workspaceSession(page);
  await openPrivacy(page);
  for (const failure of ["server", "network"] as const) {
    await page.route("**/api/businesses/*/privacy", (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      return failure === "server"
        ? route.fulfill({ status: 503, json: { error: "Unable to save privacy settings." } })
        : route.abort("failed");
    });
    await page.getByRole("checkbox", { name: "Record voicemails" }).check();
    await page.getByRole("button", { name: "Save privacy settings" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Your changes were not saved" })).toBeVisible();
    await expect(page.getByText("Privacy settings saved.")).toHaveCount(0);
    await expect(page.getByTestId("unsaved-callRecordingEnabled")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save privacy settings" })).toBeEnabled();
    await page.unroute("**/api/businesses/*/privacy");
  }
  await page.reload();
  await openPrivacy(page);
  await expect(page.getByRole("checkbox", { name: "Record voicemails" })).not.toBeChecked();
});

test("a page that cannot load the settings says so and offers a retry instead of showing guesses", async ({ page }) => {
  await workspaceSession(page);
  let fail = true;
  await page.route("**/api/businesses/*/privacy", (route) =>
    fail && route.request().method() === "GET" ? route.fulfill({ status: 503, body: "down" }) : route.continue(),
  );
  await page.goto(PATH);
  await expect(page.getByRole("alert").filter({ hasText: "could not be loaded" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Record voicemails" })).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("checkbox", { name: "Record voicemails" })).toBeVisible();
});

test("rapid changes: one save at a time, and the last confirmed value is what persists", async ({ page }) => {
  await workspaceSession(page);
  await openPrivacy(page);
  const box = page.getByRole("checkbox", { name: "Keep text message history" });
  for (let i = 0; i < 7; i += 1) await box.click();
  await expect(box).not.toBeChecked();
  let patches = 0;
  page.on("request", (r) => {
    if (r.method() === "PATCH" && /\/privacy$/.test(r.url())) patches += 1;
  });
  const save = page.getByRole("button", { name: "Save privacy settings" });
  await save.dblclick();
  await expect(page.getByRole("status").filter({ hasText: "Privacy settings saved." })).toBeVisible();
  expect(patches).toBe(1);
  for (let i = 0; i < 3; i += 1) await box.click();
  await saveAndConfirm(page);
  await page.reload();
  await openPrivacy(page);
  await expect(box).toBeChecked();
});

test("a second tab's stale save is refused and the page shows the stored values", async ({ page, context }) => {
  await workspaceSession(page);
  await openPrivacy(page);
  const other = await context.newPage();
  await openPrivacy(other);
  await page.getByRole("checkbox", { name: "Record voicemails" }).check();
  await saveAndConfirm(page);
  await other.getByRole("checkbox", { name: "Keep call transcripts" }).uncheck();
  await other.getByRole("button", { name: "Save privacy settings" }).click();
  await expect(other.getByRole("alert").filter({ hasText: "changed somewhere else" })).toBeVisible();
  await expect(other.getByRole("checkbox", { name: "Record voicemails" })).toBeChecked();
  await expect(other.getByRole("checkbox", { name: "Keep call transcripts" })).toBeChecked();
});

test("business A cannot read or change business B's settings, and B's are untouched by A's saves", async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pageA = await a.newPage();
  const pageB = await b.newPage();
  await workspaceSession(pageA);
  await workspaceSession(pageB);
  const orgA = await openPrivacy(pageA);
  const orgB = await openPrivacy(pageB);
  expect(orgA).not.toBe(orgB);

  await pageA.getByRole("checkbox", { name: "Record voicemails" }).check();
  await saveAndConfirm(pageA);

  // The same request to A's own settings works, so B's refusal below is about B.
  const own = await pageA.request.patch(`/api/businesses/${orgA}/privacy`, {
    data: { expectedVersion: 1, saveSmsHistory: true },
    headers: { origin: new URL(pageA.url()).origin },
  });
  expect(own.status()).toBe(200);

  const peek = await pageA.request.get(`/api/businesses/${orgB}/privacy`);
  expect(peek.status()).toBe(403);
  const write = await pageA.request.patch(`/api/businesses/${orgB}/privacy`, {
    data: { expectedVersion: 0, callRecordingEnabled: true },
    headers: { origin: new URL(pageA.url()).origin },
  });
  expect(write.status()).toBe(403);

  await pageB.reload();
  await openPrivacy(pageB);
  await expect(pageB.getByRole("checkbox", { name: "Record voicemails" })).not.toBeChecked();
  await a.close();
  await b.close();
});

test("on a phone: no sideways scroll, every control is reachable, and a save still persists", async ({ page }) => {
  const PHONE_WIDTH = 390;
  await page.setViewportSize({ width: PHONE_WIDTH, height: 844 });
  await workspaceSession(page);
  await openPrivacy(page);

  const sidewaysScroll = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await sidewaysScroll()).toBeLessThanOrEqual(0);

  const controls = [
    ...TOGGLES.map((toggle) => page.getByRole("checkbox", { name: toggle.name })),
    page.getByLabel("Keep call and message content for"),
    page.getByRole("button", { name: "Save privacy settings" }),
  ];
  for (const control of controls) {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE_WIDTH);
  }

  // The click fails if anything (a sticky bar, a banner) covers the button.
  await page.getByRole("checkbox", { name: "Record voicemails" }).setChecked(true);
  await saveAndConfirm(page);
  await page.reload();
  await openPrivacy(page);
  await expect(page.getByRole("checkbox", { name: "Record voicemails" })).toBeChecked();

  // The longest state: an unsaved change plus the impact note under transcripts.
  await page.getByRole("checkbox", { name: "Keep call transcripts" }).setChecked(false);
  await expect(page.getByTestId("unsaved-saveCallTranscripts")).toBeVisible();
  expect(await sidewaysScroll()).toBeLessThanOrEqual(0);
});

test("account deletion is requested only after typing the business name, and deletes nothing", async ({ page }) => {
  await workspaceSession(page);
  await page.goto("/app/settings/account");
  const ask = page.getByRole("button", { name: "Request deletion", exact: true });
  await expect(ask).toBeEnabled();
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/account/deletion-request")) posts += 1;
  });

  page.once("dialog", (dialog) => dialog.accept("Wrong Name"));
  await ask.click();
  await expect(page.getByText("The business name did not match. No deletion request was sent.")).toBeVisible();
  expect(posts).toBe(0);

  page.once("dialog", (dialog) => dialog.dismiss());
  await ask.click();
  expect(posts).toBe(0);

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("Example Plumbing");
    return dialog.accept("example plumbing");
  });
  const done = page.waitForResponse((r) => r.url().endsWith("/account/deletion-request"));
  await ask.click();
  expect((await done).status()).toBe(200);
  await expect(page.getByText("Request received for review.")).toBeVisible();
  // Still signed in to a working business.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/app\/?$/);
});
