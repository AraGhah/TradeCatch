import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test, type Page, type Route } from "@playwright/test";
import {
  ADMINS,
  CONSOLE_READ_ENDPOINTS,
  adminSession,
  freshIp,
  opsHeaders,
  provisionOrganization,
  signInWithMagicLink,
  uniqueSuffix,
} from "./support/admin-session";
import { workspaceSession } from "./support/workspace-session";

// Every console page is rendered on demand by the server. In a full-suite run the machine is busy with
// other workers, and the 5 s default is tight for a first render; 15 s matches the hydration waits in
// tests/support/hydration.ts. These tests check behavior, not speed.
const expect = baseExpect.configure({ timeout: 15_000 });

/**
 * KAN-20 acceptance tests ADM-01 .. ADM-16 for the TradeCatch admin dashboard.
 *
 * Runs against the production build with the in-memory stores the e2e harness
 * uses (no PostgreSQL, no Stripe, no Twilio, no Resend). So:
 *
 *  - Everything that is TradeCatch's own logic runs for real: administrator
 *    sign-in with a second factor, role checks on every API route, customer
 *    creation and edits, status changes and the lock-out they cause, website
 *    request review, audit records, health data and the UI.
 *  - What needs Stripe's side (ADM-06, ADM-07, ADM-10) is covered here at the UI
 *    contract with the API answering as Stripe-backed data would; the server
 *    logic behind it (price reading, plan change, payment-event recording,
 *    drift) is exercised against a fake Stripe in tests/unit/admin-billing.test.ts.
 *    Those tests are labelled "(UI contract)".
 */

const VIEWS = [
  { label: "Overview", path: "/admin", heading: "Platform overview" },
  { label: "Businesses", path: "/admin/businesses", heading: "Businesses" },
  { label: "Subscriptions", path: "/admin/subscriptions", heading: "Subscriptions" },
  { label: "Payments", path: "/admin/payments", heading: "Payments" },
  { label: "Website requests", path: "/admin/website-requests", heading: "Website requests" },
  { label: "System health", path: "/admin/system-health", heading: "System health" },
  { label: "Audit logs", path: "/admin/audit-logs", heading: "Audit logs" },
] as const;

type Json = Record<string, unknown>;

// A pooled keep-alive socket can be closed by the server between two calls (Node closes idle ones
// after 5 s). Playwright retries only that ECONNRESET, before the request is processed.
const RESET_RETRIES = 2;

async function getJson(page: Page, url: string) {
  const response = await page.request.get(url, { maxRetries: RESET_RETRIES });
  return { status: response.status(), body: (await response.json().catch(() => null)) as Json | null };
}

async function sendJson(page: Page, method: "POST" | "PATCH", url: string, data: unknown) {
  const response = await page.request.fetch(url, { method, data, maxRetries: RESET_RETRIES });
  return { status: response.status(), body: (await response.json().catch(() => null)) as Json | null };
}

/** Creates a customer the way the console does, through its API. */
async function createCustomer(page: Page, label: string, extra: Json = {}) {
  const suffix = uniqueSuffix();
  const body = {
    organizationName: `${label} ${suffix}`,
    ownerName: "Created Owner",
    ownerEmail: `owner-${suffix}@example.test`,
    plan: "essential",
    locale: "en",
    sendInvite: false,
    ...extra,
  };
  const result = await sendJson(page, "POST", "/api/admin/businesses", body);
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return { id: String(result.body?.id), name: body.organizationName, email: body.ownerEmail };
}

async function auditRows(page: Page, query = "") {
  const result = await getJson(page, `/api/admin/audit-logs?pageSize=100${query}`);
  expect(result.status).toBe(200);
  return (result.body?.rows ?? []) as Array<{
    action: string;
    actorEmail?: string;
    actorRole?: string;
    outcome?: string;
    target?: string;
    organizationId?: string;
    createdAt: string;
    changes?: { field: string; from?: string; to?: string }[];
  }>;
}

/** The Save button of the account-status form (the member rows have their own Save buttons). */
const statusSave = (page: Page) => page.locator("form").filter({ hasText: "Account status" }).getByRole("button", { name: "Save" });

const h1 = (page: Page) => page.getByRole("heading", { level: 1 });

// ---------------------------------------------------------------------------

test("ADM-01 an authorized administrator signs in and reaches every console view", async ({ page }) => {
  // No session, no access: every console endpoint refuses before anything is read.
  for (const url of CONSOLE_READ_ENDPOINTS) {
    expect((await page.request.get(url, { headers: { "x-forwarded-for": freshIp() } })).status(), url).toBe(401);
  }

  await adminSession(page, ADMINS.super("01"));
  const me = await getJson(page, "/api/admin/me");
  expect(me.body).toMatchObject({ ok: true, role: "super_admin", via: "session" });
  expect(me.body?.permissions).toEqual(expect.arrayContaining(["admin.read", "audit.read", "billing.write", "business.create"]));

  await page.goto("/admin");
  await expect(h1(page)).toHaveText("Platform overview");
  const nav = page.getByRole("navigation", { name: "TradeCatch Admin" });
  for (const view of VIEWS) {
    await nav.getByRole("link", { name: view.label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${view.path.replace(/\//g, "\\/")}\\/?$`));
    await expect(h1(page)).toHaveText(view.heading);
    await expect(nav.getByRole("link", { name: view.label, exact: true })).toHaveAttribute("aria-current", "page");
  }
  // The old billing address still lands somewhere useful.
  await page.goto("/admin/billing");
  await expect(page).toHaveURL(/\/admin\/subscriptions\/?$/);
});

test("ADM-02 a customer who opens an admin URL or calls an admin API is denied", async ({ page }) => {
  await workspaceSession(page);
  const me = await (await page.request.get("/api/app/me")).json();
  const ownOrg = String(me.organization.id);

  for (const view of VIEWS) {
    await page.goto(view.path);
    await expect(page, view.path).toHaveURL(/\/app\/?$/);
  }
  await page.goto("/fr/admin/audit-logs");
  await expect(page).toHaveURL(/\/fr\/app\/?$/);

  for (const url of [...CONSOLE_READ_ENDPOINTS, `/api/admin/businesses/${ownOrg}`, `/api/admin/website-requests/wr_unknown`]) {
    expect((await page.request.get(url)).status(), url).toBe(403);
  }
  // Writes are refused too, even against the customer's own business.
  const writes: Array<["POST" | "PATCH", string, unknown]> = [
    ["POST", "/api/admin/businesses", { organizationName: "Intruder", ownerName: "x", ownerEmail: "x@example.test", plan: "essential" }],
    ["PATCH", `/api/admin/businesses/${ownOrg}`, { name: "Hijacked" }],
    ["POST", `/api/admin/businesses/${ownOrg}/status`, { status: "churned", confirm: "deactivate" }],
    ["POST", "/api/admin/subscriptions/sub_123", { action: "cancel_at_period_end", confirm: "cancel" }],
    ["PATCH", "/api/admin/website-requests/wr_123", { status: "approved" }],
  ];
  for (const [method, url, data] of writes) {
    expect((await sendJson(page, method, url, data)).status, `${method} ${url}`).toBe(403);
  }
  // Nothing changed.
  const after = await (await page.request.get("/api/app/me")).json();
  expect(after.organization.name).toBe(me.organization.name);
  expect(after.organization.status).toBe("active");
});

test("ADM-03 an administrator creates a customer account; public registration stays closed", async ({ page, browser }) => {
  await adminSession(page, ADMINS.super("03"));
  const suffix = uniqueSuffix();
  const name = `Created Plumbing ${suffix}`;
  const email = `new-owner-${suffix}@example.test`;

  await page.goto("/admin/businesses");
  await page.getByRole("button", { name: "Create customer account" }).click();
  // Required fields are enforced before anything is sent.
  await page.locator("#cb-org").fill(name);
  await page.locator("#cb-owner").fill("New Owner");
  await page.locator("#cb-email").fill("not-an-email");
  await page.locator("#cb-plan").selectOption("professional");
  await page.locator("#cb-city").fill("Halifax");
  await page.getByLabel("Email the owner an invitation to set their password").uncheck();
  await page.getByRole("button", { name: "Create account" }).click();
  expect(await page.locator("#cb-email").evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  await page.locator("#cb-email").fill(email);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText(`Created ${name}.`)).toBeVisible();
  await expect(page.getByText("No invitation was sent.")).toBeVisible();
  await page.locator("#bf-q").fill(name);
  await expect(page.getByRole("link", { name }).first()).toBeVisible();

  const listed = await getJson(page, `/api/admin/businesses?q=${encodeURIComponent(name)}`);
  const rows = listed.body?.rows as Array<Json>;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ name, plan: "professional", status: "active" });
  expect(rows[0].owner).toMatchObject({ email });

  // The same email cannot become a second business.
  const again = await sendJson(page, "POST", "/api/admin/businesses", {
    organizationName: `${name} Two`,
    ownerName: "Dup",
    ownerEmail: email,
    plan: "essential",
    sendInvite: false,
  });
  expect(again.status).toBe(409);

  // The owner can really sign in, and sees their own workspace.
  const customer = await browser.newContext();
  const customerPage = await customer.newPage();
  await signInWithMagicLink(customerPage, email, "en", /\/app\/?$/);
  const owned = await (await customerPage.request.get("/api/app/me")).json();
  expect(owned.organization.name).toBe(name);
  expect(owned.organization.plan).toBe("professional");
  await customer.close();

  // Public registration is closed: an address nobody created gets no session.
  const stranger = await page.request.post("/api/auth/magic-link", {
    data: { email: `stranger-${suffix}@example.test`, locale: "en" },
    headers: { "x-forwarded-for": freshIp() },
  });
  expect((await stranger.json().catch(() => ({}))).devToken).toBeFalsy();
});

test("ADM-04 updating business information persists", async ({ page }) => {
  await adminSession(page, ADMINS.super("04"));
  const customer = await createCustomer(page, "Edit Roofing", { city: "Moncton" });

  await page.goto(`/admin/businesses/${customer.id}`);
  const newName = `${customer.name} Ltd`;
  await page.locator("#eb-name").fill(newName);
  await page.locator("#eb-city").fill("Saint John");
  await page.locator("#eb-phone").fill("(506) 555-0142");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved. The change is in the audit log.")).toBeVisible();

  // Reloading shows what the server holds, not what the form remembered.
  await page.reload();
  await expect(page.locator("#eb-name")).toHaveValue(newName);
  await expect(page.locator("#eb-city")).toHaveValue("Saint John");
  await expect(page.locator("#eb-phone")).toHaveValue("+15065550142");

  const detail = await getJson(page, `/api/admin/businesses/${customer.id}`);
  expect(detail.body?.business).toMatchObject({ name: newName, city: "Saint John", phoneE164: "+15065550142" });

  // An invalid edit is refused with a field error and changes nothing.
  const bad = await sendJson(page, "PATCH", `/api/admin/businesses/${customer.id}`, { name: "x".repeat(300) });
  expect(bad.status).toBe(400);
  const unknown = await sendJson(page, "PATCH", `/api/admin/businesses/${customer.id}`, { plan: "professional" });
  expect(unknown.status, "plan is not editable here").toBe(400);
  expect((await getJson(page, `/api/admin/businesses/${customer.id}`)).body?.business).toMatchObject({ name: newName });

  // The change is audited with before and after, contact details masked.
  const rows = await auditRows(page, `&businessId=${customer.id}`);
  const updated = rows.find((row) => row.action === "admin_business_updated");
  expect(updated, JSON.stringify(rows)).toBeTruthy();
  const phoneChange = updated?.changes?.find((change) => change.field === "phoneE164" || change.field === "phone");
  expect(JSON.stringify(updated?.changes)).not.toContain("5065550142");
  expect(phoneChange?.to).toMatch(/\*\*\*0142/);
});

test("ADM-05 deactivating a business restricts its access, and activating restores it", async ({ page, browser }) => {
  await adminSession(page, ADMINS.super("05"));
  const customer = await createCustomer(page, "Lockout Electric");

  const customerContext = await browser.newContext();
  const customerPage = await customerContext.newPage();
  await signInWithMagicLink(customerPage, customer.email, "en", /\/app\/?$/);
  expect((await customerPage.request.get("/api/app/me")).status()).toBe(200);

  await page.goto(`/admin/businesses/${customer.id}`);
  const status = page.getByLabel("Account status");
  await status.selectOption("churned");
  // A wrong confirmation word changes nothing.
  await page.getByLabel("Type the confirmation word").fill("nope");
  await statusSave(page).click();
  await expect(page.getByText("That change was not applied.")).toBeVisible();
  expect((await customerPage.request.get("/api/app/me")).status()).toBe(200);

  await page.getByLabel("Type the confirmation word").fill("deactivate");
  await statusSave(page).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

  // The customer's existing session is refused on the very next call (this route reports every tenant error as 401).
  const locked = await customerPage.request.get("/api/app/me");
  expect(locked.status()).toBe(401);
  expect((await locked.json()).error).toBe("Organization is not active.");
  expect((await getJson(page, `/api/admin/businesses/${customer.id}`)).body?.business).toMatchObject({ status: "churned" });

  await page.reload();
  await page.getByLabel("Account status").selectOption("active");
  await page.getByLabel("Type the confirmation word").fill("activate");
  await statusSave(page).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  expect((await customerPage.request.get("/api/app/me")).status()).toBe(200);
  await customerContext.close();

  const rows = await auditRows(page, `&businessId=${customer.id}`);
  expect(rows.filter((row) => row.action === "admin_account_status").length).toBeGreaterThanOrEqual(2);
  expect(rows.some((row) => row.action === "admin_account_status_refused" || row.outcome === "failed" || row.outcome === "denied")).toBe(true);
});

// ---- ADM-06 / ADM-07 / ADM-10: the Stripe-backed views (UI contract) -------

const orgRef = { id: "org_mock_1", name: "Mock Plumbing" };
const stripeSub = (over: Json = {}) => ({
  id: "sub_active1",
  status: "active",
  customerId: "cus_1",
  customerEmail: "owner@mock-plumbing.example",
  customerName: "Mock Owner",
  metadataOrganizationId: null,
  priceId: "price_professional",
  plan: "professional",
  unitAmountCents: 34999,
  currency: "cad",
  interval: "month",
  cancelAtPeriodEnd: false,
  currentPeriodEnd: "2030-01-15T12:00:00.000Z",
  latestInvoiceId: null,
  createdAt: "2029-01-15T12:00:00.000Z",
  livemode: false,
  itemId: "si_1",
  itemCount: 1,
  organization: orgRef,
  recorded: { plan: "professional", status: "active", cancelAtPeriodEnd: false, syncedAt: "2029-12-01T12:00:00.000Z" },
  drift: [],
  ...over,
});
const price = (over: Json) => ({
  planLabel: "",
  priceId: "price_x",
  currency: "cad",
  interval: "month",
  active: true,
  productName: "TradeCatch",
  error: null,
  ...over,
});

function mockSubscriptions(page: Page, subscriptions: Json[]) {
  return page.route("**/api/admin/subscriptions*", (route: Route) =>
    route.fulfill({
      json: {
        ok: true,
        stripe: { configured: true, livemode: false, reason: null },
        source: "stripe",
        note: "Test mode: these are Stripe test-mode subscriptions.",
        hasMore: false,
        nextCursor: null,
        prices: [
          price({ plan: "essential", planLabel: "Essential", priceId: "price_essential", unitAmountCents: 24999, catalogMonthlyCad: 249.99, matchesCatalog: true }),
          price({ plan: "professional", planLabel: "Professional", priceId: "price_professional", unitAmountCents: 34900, catalogMonthlyCad: 349.99, matchesCatalog: false }),
        ],
        subscriptions,
      },
    }),
  );
}

test("ADM-06 subscriptions show the real Stripe prices, statuses and billing dates (UI contract)", async ({ page }) => {
  await adminSession(page, ADMINS.super("06"));
  await mockSubscriptions(page, [
    stripeSub(),
    stripeSub({ id: "sub_pastdue", status: "past_due", plan: "essential", unitAmountCents: 24999, organization: { id: "org_2", name: "Late Payer HVAC" }, drift: ["status"], recorded: { plan: "essential", status: "active", cancelAtPeriodEnd: false, syncedAt: "2029-12-01T12:00:00.000Z" } }),
    stripeSub({ id: "sub_canceled", status: "canceled", plan: "essential", unitAmountCents: 24999, organization: { id: "org_3", name: "Gone Painting" } }),
    stripeSub({ id: "sub_incomplete", status: "incomplete", plan: "professional", organization: null, customerEmail: "unlinked@example.test", drift: ["not_recorded"], recorded: null }),
    stripeSub({ id: "sub_ending", status: "active", cancelAtPeriodEnd: true, organization: { id: "org_5", name: "Ending Carpentry" } }),
  ]);
  await page.goto("/admin/subscriptions");
  await expect(h1(page)).toHaveText("Subscriptions");

  // Plan prices come from Stripe, and a difference from the catalog is called out.
  const prices = page.getByRole("heading", { name: "Plan prices in Stripe" }).locator("..");
  await expect(prices).toContainText("$249.99 per month");
  await expect(prices).toContainText("Matches the catalog");
  await expect(prices).toContainText("$349.00 per month");
  await expect(prices).toContainText("Differs from the catalog");
  await expect(page.getByText("Test mode: these are Stripe test-mode subscriptions.")).toBeVisible();

  const table = page.getByRole("table", { name: "Subscriptions" });
  const row = (text: string) => table.getByRole("row").filter({ hasText: text });
  await expect(row("Mock Plumbing").first()).toContainText("Professional");
  await expect(row("Mock Plumbing").first()).toContainText("Active");
  await expect(row("Mock Plumbing").first()).toContainText("$349.99 / mo");
  await expect(row("Mock Plumbing").first()).toContainText("Jan 15, 2030");
  await expect(row("Late Payer HVAC")).toContainText("Past due");
  await expect(row("Late Payer HVAC")).toContainText("Differs: status");
  await expect(row("Gone Painting")).toContainText("Canceled");
  await expect(row("unlinked@example.test")).toContainText("Incomplete");
  await expect(row("unlinked@example.test")).toContainText("Not linked to a business");
  await expect(row("unlinked@example.test")).toContainText("Not recorded yet");
  await expect(row("Ending Carpentry")).toContainText("Ends Jan 15, 2030");
  // A canceled subscription offers no actions; an active one does.
  await expect(row("Gone Painting").getByRole("button")).toHaveCount(0);
  await expect(row("Mock Plumbing").first().getByRole("button", { name: "Switch to Essential" })).toBeVisible();
  await expect(row("Ending Carpentry").getByRole("button", { name: "Resume" })).toBeVisible();
});

test("ADM-07 changing a subscription needs confirmation, is sent once, and reports billing and entitlements (UI contract)", async ({ page }) => {
  await adminSession(page, ADMINS.super("07"));
  await mockSubscriptions(page, [stripeSub()]);
  const requests: Json[] = [];
  let outcome: Json = { synchronized: true, entitlementsUpdated: true };
  await page.route("**/api/admin/subscriptions/sub_active1", async (route) => {
    requests.push(route.request().postDataJSON() as Json);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({
      json: { ok: true, organizationId: "org_mock_1", before: { plan: "professional" }, after: { plan: "essential" }, ...outcome },
    });
  });

  await page.goto("/admin/subscriptions");
  await page.getByRole("button", { name: "Switch to Essential" }).click();
  const confirm = page.getByRole("button", { name: "Change plan" });
  // The consequences are spelled out, and nothing is sent until the word is typed.
  await expect(page.getByText(/Nothing is charged or refunded now/)).toBeVisible();
  await expect(page.getByRole("form").getByText(/\$249\.99 per month/)).toBeVisible();
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/Type .change plan. to confirm/).fill("change plan");
  await expect(confirm).toBeEnabled();
  // Hammering the button sends exactly one request.
  await confirm.click();
  await confirm.click({ force: true, timeout: 500 }).catch(() => undefined);
  await expect(page.getByText("Plan changed to Essential.")).toBeVisible();
  await expect(page.getByText("Stripe and TradeCatch agree, and the business's features are up to date.")).toBeVisible();
  expect(requests).toEqual([{ action: "change_plan", targetPlan: "essential", confirm: "change plan" }]);

  // When Stripe changed but TradeCatch has not caught up, the page says so instead of claiming success.
  outcome = { synchronized: false, entitlementsUpdated: null };
  await page.getByRole("button", { name: "Switch to Essential" }).click();
  await page.getByLabel(/Type .change plan. to confirm/).fill("change plan");
  await page.getByRole("button", { name: "Change plan" }).click();
  await expect(page.getByText(/TradeCatch has not confirmed it yet/)).toBeVisible();
  expect(requests).toHaveLength(2);

  // Real server: with no Stripe configured nothing can be created or changed.
  const real = await sendJson(page, "POST", "/api/admin/subscriptions/sub_real_check", { action: "cancel_at_period_end", confirm: "cancel" });
  expect(real.status).toBe(503);
  expect(real.body).toMatchObject({ code: "stripe_unconfigured" });
  const badWord = await sendJson(page, "POST", "/api/admin/subscriptions/sub_real_check", { action: "resume", confirm: "" });
  expect([400, 503]).toContain(badWord.status);
  const extra = await sendJson(page, "POST", "/api/admin/subscriptions/sub_real_check", { action: "resume", confirm: "resume", amount: 1 });
  expect(extra.status, "unknown fields are refused").toBe(400);
});

test("ADM-08 a new website request is saved, shown with its details, and the email notification is tracked", async ({ page }) => {
  await adminSession(page, ADMINS.super("08"));
  const suffix = uniqueSuffix();
  const business = `Fresh Fence ${suffix}`;
  const submit = await page.request.post("/api/website-requests", {
    headers: { "x-forwarded-for": freshIp() },
    data: {
      requestType: "improve",
      businessName: business,
      contactName: "Casey Contractor",
      contactEmail: `casey-${suffix}@example.test`,
      contactPhone: "902-555-0111",
      currentWebsiteUrl: "freshfence.example.test",
      focusAreas: ["mobile", "lead_capture"],
      notes: "Please make the phone number easier to find.",
      language: "en",
      turnstileToken: "e2e-token",
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(submit.status()).toBe(200);

  await page.goto("/admin/website-requests");
  await page.locator("#wf-q").fill(business);
  const table = page.getByRole("table", { name: "Website requests" });
  const row = table.getByRole("row").filter({ hasText: business });
  await expect(row).toContainText("Casey Contractor");
  await expect(row).toContainText(`casey-${suffix}@example.test`);
  await expect(row).toContainText("Improve existing");
  await expect(row).toContainText("Mobile-friendly");
  await expect(row).toContainText("Pending");
  await expect(row).toContainText("Not requested");

  await row.getByRole("button", { name: "Review" }).click();
  await expect(page.getByText("Please make the phone number easier to find.")).toBeVisible();
  // No team mailbox or email provider in this harness: the attempt is recorded honestly, not faked.
  await expect(page.locator("dt", { hasText: "Team email" }).locator("..")).toContainText("Not configured");
  await expect(page.getByText("Request submitted")).toBeVisible();
  await expect(page.getByText(/Team email: Not configured/)).toBeVisible();

  const list = await getJson(page, `/api/admin/website-requests?q=${encodeURIComponent(business)}`);
  const saved = (list.body?.requests as Json[])[0];
  expect(saved).toMatchObject({ businessName: business, status: "submitted", paymentStatus: "not_requested", notificationStatus: "not_configured" });
  const counts = list.body?.statusCounts as Record<string, number>;
  expect(counts.submitted).toBeGreaterThanOrEqual(1);
  // Resubmitting the same form (a double click, a retry) does not create a second request.
});

test("ADM-09 reviewing a request updates its status; payment is only recorded, never charged", async ({ page }, testInfo) => {
  // A retry shares the server's in-memory store with its first attempt.
  await adminSession(page, ADMINS.super(testInfo.retry === 0 ? "09" : "39"));
  const suffix = uniqueSuffix();
  const business = `Review Roofing ${suffix}`;
  const key = crypto.randomUUID();
  const body = {
    requestType: "new",
    businessName: business,
    contactName: "Riley Reviewer",
    contactEmail: `riley-${suffix}@example.test`,
    contactPhone: "",
    currentWebsiteUrl: "",
    focusAreas: ["design"],
    notes: "",
    language: "en",
    turnstileToken: "e2e-token",
    idempotencyKey: key,
  };
  const ip = freshIp();
  expect((await page.request.post("/api/website-requests", { headers: { "x-forwarded-for": ip }, data: body })).status()).toBe(200);
  // The same submission again is the same request.
  expect((await page.request.post("/api/website-requests", { headers: { "x-forwarded-for": ip }, data: body })).status()).toBe(200);
  const listed = await getJson(page, `/api/admin/website-requests?q=${encodeURIComponent(business)}`);
  expect(listed.body?.requests).toHaveLength(1);
  const id = String((listed.body?.requests as Json[])[0].id);

  await page.goto("/admin/website-requests");
  await page.locator("#wf-q").fill(business);
  const row = page.getByRole("table", { name: "Website requests" }).getByRole("row").filter({ hasText: business });
  await row.getByRole("button", { name: "Review" }).click();

  // Work cannot be approved or paid for before it has been reviewed.
  await expect(page.getByLabel("Scope of work")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Request payment" })).toBeDisabled();
  const early = await sendJson(page, "PATCH", `/api/admin/website-requests/${id}`, { status: "approved" });
  expect(early.status).toBe(409);
  const earlyPay = await sendJson(page, "PATCH", `/api/admin/website-requests/${id}`, { paymentStatus: "requested" });
  expect([409, 422]).toContain(earlyPay.status);

  await page.getByRole("button", { name: "Start review" }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await expect(row).toContainText("Under review");

  // A rejection needs a reason and a typed confirmation.
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByLabel(/Type .reject. to confirm/).fill("reject");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText(/Add the reason in the internal note before rejecting/)).toBeVisible();
  expect((await getJson(page, `/api/admin/website-requests/${id}`)).body?.request).toMatchObject({ status: "in_review" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  // Approve: now it is approved, and payment can be requested, which only records the request.
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(row).toContainText("Approved");
  // Payment needs a price first: the button says so instead of offering a step that must fail.
  const requestPayment = page.getByRole("button", { name: "Request payment" });
  await expect(requestPayment).toBeDisabled();
  await expect(page.getByText(/once the request is approved or quoted and has a price/)).toBeVisible();
  await page.getByLabel("Scope of work").fill("New five-page website with a contact form.");
  await page.getByLabel(/Final price \(CAD\)/).fill("699.99");
  await page.getByRole("button", { name: "Save scope, price and note" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await expect(requestPayment).toBeEnabled();
  await requestPayment.click();
  await expect(page.getByText(/The customer is not charged by TradeCatch/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(row).toContainText("Requested");
  const detail = await getJson(page, `/api/admin/website-requests/${id}`);
  expect(detail.body?.request).toMatchObject({ status: "approved", paymentStatus: "requested" });
  expect((detail.body?.request as Json).quotedPriceCad).toBe(699.99);

  // History keeps every step, with who and when.
  const events = (detail.body?.history as Array<{ kind: string; fromStatus?: string; toStatus?: string; actor?: string; createdAt: string }>);
  expect(events.map((event) => event.kind)).toEqual(expect.arrayContaining(["submitted", "status_changed", "payment_updated"]));
  expect(events.find((event) => event.toStatus === "approved")?.actor).toBeTruthy();
  expect(events.every((event) => Date.parse(event.createdAt) > 0)).toBe(true);
  await expect(page.getByText("Status: Pending → Under review")).toBeVisible();

  // Payment can be settled by hand once received.
  await page.getByRole("button", { name: "Mark as paid" }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(row).toContainText("Paid");
});

test("ADM-10 a failed payment is visible on Payments and the Overview (UI contract)", async ({ page }) => {
  await adminSession(page, ADMINS.super("10"));
  await page.route("**/api/admin/payments*", (route) =>
    route.fulfill({
      json: {
        ok: true,
        generatedAt: new Date().toISOString(),
        invoicesError: null,
        invoices: {
          stripe: { configured: true, livemode: false, reason: null },
          note: null,
          invoicesHasMore: false,
          invoicesNextCursor: null,
          outstanding: [{ currency: "cad", outstandingCents: 34999, overdueCents: 34999, openInvoices: 1 }],
          invoices: [
            { id: "in_open1", number: "TC-0001", status: "open", customerId: "cus_1", customerEmail: "late@example.test", subscriptionId: "sub_1", currency: "cad", amountDueCents: 34999, amountPaidCents: 0, amountRemainingCents: 34999, attemptCount: 2, nextPaymentAttempt: null, dueDate: "2020-01-01T12:00:00.000Z", createdAt: "2019-12-01T12:00:00.000Z", paidAt: null, hostedInvoiceUrl: "https://invoice.stripe.example/in_open1", livemode: false, organization: { id: "org_late", name: "Late Payer HVAC" } },
            { id: "in_paid1", number: "TC-0002", status: "paid", customerId: "cus_2", customerEmail: "ok@example.test", subscriptionId: "sub_2", currency: "cad", amountDueCents: 24900, amountPaidCents: 24900, amountRemainingCents: 0, attemptCount: 1, nextPaymentAttempt: null, dueDate: null, createdAt: "2019-12-01T12:00:00.000Z", paidAt: "2019-12-02T12:00:00.000Z", hostedInvoiceUrl: null, livemode: false, organization: { id: "org_ok", name: "Paid Up Painting" } },
          ],
        },
        events: {
          total: 1,
          page: 1,
          pageSize: 20,
          pages: 1,
          rows: [
            { eventId: "evt_fail1", eventType: "invoice.payment_failed", livemode: false, organizationId: "org_late", organizationName: "Late Payer HVAC", customerId: "cus_1", subscriptionId: "sub_1", invoiceId: "in_open1", amountCents: 34999, currency: "cad", attemptCount: 2, nextAttemptAt: "2030-02-01T12:00:00.000Z", outcome: "failed", createdAt: "2030-01-30T12:00:00.000Z" },
          ],
        },
      },
    }),
  );
  await page.route("**/api/admin/overview*", (route) =>
    route.fulfill({
      json: {
        ok: true,
        generatedAt: new Date().toISOString(),
        kpis: { customers: 3, activeSubscriptions: 2, suspended: 0, mrr: { amountCad: 598.99, source: "stripe", note: null }, failedPayments30d: 1, pastDueSubscriptions: 1, calls: 12, openAlerts: 1, pendingWebsiteRequests: 0 },
        alerts: [{ id: "failed_payment:evt_fail1", kind: "failed_payment", severity: "critical", title: "Payment failed for Late Payer HVAC", detail: "$349.99 CAD, attempt 2", at: "2030-01-30T12:00:00.000Z", href: "/admin/payments" }],
      },
    }),
  );

  await page.goto("/admin/payments");
  const events = page.getByRole("table", { name: "Payment events" });
  await expect(events.getByRole("row").filter({ hasText: "Late Payer HVAC" })).toContainText("Failed");
  await expect(events).toContainText("$349.99");
  await expect(events).toContainText("2"); // attempt
  await expect(page.getByText("Outstanding balance (cad)")).toBeVisible();
  const invoices = page.getByRole("table", { name: "Stripe invoices" });
  await expect(invoices.getByRole("row").filter({ hasText: "TC-0001" })).toContainText("Open · Overdue");
  await expect(invoices.getByRole("row").filter({ hasText: "TC-0002" })).toContainText("Paid");
  await expect(invoices.getByRole("link", { name: "View" })).toHaveAttribute("href", "https://invoice.stripe.example/in_open1");

  await page.goto("/admin");
  const alerts = page.getByRole("heading", { name: "Alerts", exact: true }).locator("..");
  await expect(alerts).toContainText("Payment failed for Late Payer HVAC");
  await expect(alerts).toContainText("Critical");
  await alerts.getByRole("link", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/admin\/payments\/?$/);

  // Real server: with no database the page says what it cannot show instead of an empty "all clear".
  await page.unroute("**/api/admin/payments*");
  await page.goto("/admin/payments");
  await expect(h1(page)).toHaveText("Payments");
  await expect(page.getByText(/Stripe is not configured on this server/)).toBeVisible();
});

test("ADM-11 webhook and API failures show diagnostics on System Health", async ({ page }) => {
  await adminSession(page, ADMINS.super("11"));
  // A forged delivery is refused, and recorded for the operator.
  const forged = await page.request.post("/api/webhooks/stripe", {
    headers: { "Content-Type": "application/json", "Stripe-Signature": "t=1,v1=00", "x-forwarded-for": freshIp() },
    data: JSON.stringify({ id: "evt_forged", type: "invoice.payment_failed" }),
  });
  expect(forged.status()).toBe(401);

  const health = await getJson(page, "/api/admin/health");
  expect(health.status).toBe(200);
  const webhookFailures = health.body?.webhookFailures as Array<{ operation: string; service: string; errorCode: string; severity: string }>;
  expect(webhookFailures.some((failure) => failure.operation === "webhook.signature" && failure.errorCode === "invalid_signature")).toBe(true);
  // Diagnostics never carry secrets or card data.
  expect(JSON.stringify(health.body)).not.toMatch(/sk_(live|test)_|whsec_|Bearer\s|\b\d{13,19}\b/);
  expect((health.body?.integrations as Array<{ key: string }>).map((i) => i.key)).toEqual(expect.arrayContaining(["twilio", "bland", "stripe", "resend", "cloudflare"]));

  await page.goto("/admin/system-health");
  await expect(h1(page)).toHaveText("System health");
  await expect(page.getByRole("heading", { name: "Webhook failures" })).toBeVisible();
  const webhookTable = page.getByRole("table", { name: "Webhook failures" });
  await expect(webhookTable).toContainText("webhook.signature");
  await expect(webhookTable).toContainText("invalid_signature");
  await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  // Cloudflare is reported as not connected rather than invented.
  const integrations = page.getByRole("heading", { name: "Integrations", exact: true }).locator("..");
  await expect(integrations.getByText("Cloudflare", { exact: true })).toBeVisible();
  await expect(integrations).toContainText("Not connected");
  // Twilio and Bland are not configured in this harness, and the page says so.
  await expect(page.getByText("Not configured").first()).toBeVisible();

  // Filters narrow the diagnostics; a service with nothing recorded shows an empty state.
  await page.locator("#hf-service").selectOption("twilio_sms");
  await expect(page.getByText("No errors match these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(webhookTable).toContainText("webhook.signature");

  // Refresh is visible and works, and the reading says when it was taken.
  await expect(page.getByText(/^Updated /)).toBeVisible();
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
});

test("ADM-12 sensitive operations create audit records that cannot be altered and hide secrets", async ({ page }) => {
  const admin = await adminSession(page, ADMINS.super("12"));
  const customer = await createCustomer(page, "Audited Glass", { phone: "(902) 555-0199" });
  await sendJson(page, "PATCH", `/api/admin/businesses/${customer.id}`, { city: "Truro", phone: "902-555-0123" });
  const refused = await sendJson(page, "POST", `/api/admin/businesses/${customer.id}/status`, { status: "suspended", confirm: "wrong" });
  expect(refused.status).toBeGreaterThanOrEqual(400);
  await sendJson(page, "POST", `/api/admin/businesses/${customer.id}/status`, { status: "suspended", confirm: "suspend" });

  const rows = await auditRows(page, `&businessId=${customer.id}`);
  const created = rows.find((row) => row.action === "admin_business_created");
  expect(created, JSON.stringify(rows)).toBeTruthy();
  expect(created).toMatchObject({ actorEmail: admin.email, actorRole: "super_admin", outcome: "success" });
  expect(Date.parse(created!.createdAt)).toBeGreaterThan(Date.now() - 10 * 60_000);
  const updated = rows.find((row) => row.action === "admin_business_updated");
  expect(updated?.changes?.some((change) => change.field === "city" && change.to === "Truro")).toBe(true);
  expect(rows.some((row) => row.action === "admin_account_status" && row.outcome === "success")).toBe(true);

  // What is stored is masked: no full phone number, no email local part, no secrets, ever.
  const everything = JSON.stringify(rows);
  expect(everything).not.toContain("9025550123");
  expect(everything).not.toContain("9025550199");
  expect(everything).not.toContain(customer.email);
  expect(everything).not.toMatch(/sk_(live|test)_|whsec_|password|Bearer\s/i);

  // Searchable by what (action), which record (target) and who (administrator).
  expect((await auditRows(page, `&action=admin_business_created`)).some((row) => row.target === customer.id)).toBe(true);
  expect((await auditRows(page, `&q=${encodeURIComponent(customer.id)}`)).length).toBeGreaterThanOrEqual(1);
  expect((await auditRows(page, `&q=${encodeURIComponent(admin.email)}`)).length).toBeGreaterThanOrEqual(1);
  const today = new Date().toISOString().slice(0, 10);
  expect((await auditRows(page, `&from=${today}&to=${today}&businessId=${customer.id}`)).length).toBeGreaterThanOrEqual(1);
  expect(await auditRows(page, `&from=2000-01-01&to=2000-01-02&businessId=${customer.id}`)).toHaveLength(0);

  // Read-only: there is no way to edit, remove or add a record through the API.
  for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
    const response = await page.request.fetch("/api/admin/audit-logs", { method, data: {} });
    expect(response.status(), method).toBe(405);
  }
  expect((await auditRows(page, `&businessId=${customer.id}`)).length).toBe(rows.length);

  // The Audit Logs view shows it, with the changes expandable.
  await page.goto("/admin/audit-logs");
  // The record's id is unique to this test; other administrators' rows (run in parallel) are filtered out.
  await page.locator("#af-q").fill(customer.id);
  const table = page.getByRole("table", { name: "Audit log" });
  const row = table.getByRole("row").filter({ hasText: "admin_business_created" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(admin.email);
  await expect(row).toContainText("Succeeded");
  await page.locator("#af-action").fill("admin_business_updated");
  const updatedRow = table.getByRole("row").filter({ hasText: "admin_business_updated" });
  await expect(updatedRow).toHaveCount(1);
  await updatedRow.getByRole("button", { name: /Show/ }).click();
  await expect(page.getByText(/city: .* → Truro/)).toBeVisible();
  // The badge starts with a decorative (aria-hidden) glyph, so match the end of its text.
  await expect(page.getByText(/Read-only$/)).toBeVisible();
});

test("ADM-13 the console is consistent after a refresh and after signing in again", async ({ page }) => {
  const admin = await adminSession(page, ADMINS.super("13"));
  const customer = await createCustomer(page, "Persistent Pavers", { city: "Sydney" });
  const before = (await getJson(page, `/api/admin/businesses?q=${encodeURIComponent(customer.name)}`)).body;

  await page.goto("/admin/businesses");
  await page.locator("#bf-q").fill(customer.name);
  await expect(page.getByRole("link", { name: customer.name }).first()).toBeVisible();
  await page.reload();
  await page.locator("#bf-q").fill(customer.name);
  await expect(page.getByRole("link", { name: customer.name }).first()).toBeVisible();

  // Sign out, sign back in (a new session with a new second factor), and see the same data.
  expect((await page.request.post("/api/auth/logout")).status()).toBeLessThan(400);
  expect((await page.request.get("/api/admin/businesses")).status()).toBe(401);
  await admin.signInAgain();
  const after = (await getJson(page, `/api/admin/businesses?q=${encodeURIComponent(customer.name)}`)).body;
  expect(after?.rows).toEqual(before?.rows);
  await page.goto("/admin/businesses");
  await page.locator("#bf-q").fill(customer.name);
  await expect(page.getByRole("link", { name: customer.name }).first()).toBeVisible();
  await page.goto(`/admin/businesses/${customer.id}`);
  await expect(page.locator("#eb-city")).toHaveValue("Sydney");

  // The audit trail survives the session too.
  expect((await auditRows(page, `&businessId=${customer.id}`)).some((row) => row.action === "admin_business_created")).toBe(true);
});

test("ADM-14 rapid repeated clicks and concurrent requests never create duplicates", async ({ page }) => {
  await adminSession(page, ADMINS.super("14"));
  const suffix = uniqueSuffix();
  const name = `Rapid Click Co ${suffix}`;

  // UI: five clicks on Create account while the request is in flight send one request.
  let posts = 0;
  await page.route("**/api/admin/businesses", async (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    await route.continue();
  });
  await page.goto("/admin/businesses");
  await page.getByRole("button", { name: "Create customer account" }).click();
  await page.locator("#cb-org").fill(name);
  await page.locator("#cb-owner").fill("Rapid Owner");
  await page.locator("#cb-email").fill(`rapid-${suffix}@example.test`);
  await page.getByLabel("Email the owner an invitation to set their password").uncheck();
  const submit = page.getByRole("button", { name: "Create account" });
  await submit.evaluate((button: HTMLButtonElement) => {
    for (let i = 0; i < 5; i += 1) button.click();
  });
  await expect(page.getByText(`Created ${name}.`)).toBeVisible();
  expect(posts).toBe(1);
  expect(((await getJson(page, `/api/admin/businesses?q=${encodeURIComponent(name)}`)).body?.rows as Json[]).length).toBe(1);

  // Server: the same create sent six times at once yields one business, whatever the client does.
  const dup = `Concurrent Co ${suffix}`;
  const payload = { organizationName: dup, ownerName: "Concurrent", ownerEmail: `concurrent-${suffix}@example.test`, plan: "essential", sendInvite: false };
  const results = await Promise.all(Array.from({ length: 6 }, () => sendJson(page, "POST", "/api/admin/businesses", payload)));
  const statuses = results.map((result) => result.status).sort();
  expect(statuses.filter((status) => status === 201)).toHaveLength(1);
  expect(statuses.filter((status) => status !== 201).every((status) => status === 409 || status === 429)).toBe(true);
  expect(((await getJson(page, `/api/admin/businesses?q=${encodeURIComponent(dup)}`)).body?.rows as Json[]).length).toBe(1);

  // Business status: double-clicking Save sends one change.
  await page.unroute("**/api/admin/businesses");
  const customer = await createCustomer(page, "Double Click Dental");
  let statusPosts = 0;
  await page.route(`**/api/admin/businesses/${customer.id}/status`, async (route) => {
    statusPosts += 1;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.goto(`/admin/businesses/${customer.id}`);
  await page.getByLabel("Account status").selectOption("suspended");
  await page.getByLabel("Type the confirmation word").fill("suspend");
  await statusSave(page).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
    button.click();
  });
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  expect(statusPosts).toBe(1);
  const statusRows = (await auditRows(page, `&businessId=${customer.id}`)).filter((row) => row.action === "admin_account_status" && row.outcome === "success");
  expect(statusRows).toHaveLength(1);
});

test("ADM-15 unauthorized data access is rejected by role, identity and origin", async ({ page, browser, request }) => {
  // A read-only administrator can look, never change.
  const readOnly = await adminSession(page, ADMINS.readOnly);
  expect((await getJson(page, "/api/admin/me")).body).toMatchObject({ role: "read_only" });
  expect((await getJson(page, "/api/admin/businesses")).status).toBe(200);
  expect((await getJson(page, "/api/admin/audit-logs")).status, "audit is not for read-only").toBe(403);
  const victim = await opsCustomer(page);
  const writes: Array<["POST" | "PATCH", string, unknown]> = [
    ["POST", "/api/admin/businesses", { organizationName: "RO Create", ownerName: "x", ownerEmail: `ro-${uniqueSuffix()}@example.test`, plan: "essential", sendInvite: false }],
    ["PATCH", `/api/admin/businesses/${victim.id}`, { city: "Nowhere" }],
    ["POST", `/api/admin/businesses/${victim.id}/status`, { status: "suspended", confirm: "suspend" }],
    ["POST", "/api/admin/subscriptions/sub_ro", { action: "cancel_at_period_end", confirm: "cancel" }],
    ["PATCH", "/api/admin/website-requests/wr_ro", { status: "approved" }],
  ];
  for (const [method, url, data] of writes) {
    expect((await sendJson(page, method, url, data)).status, `read-only ${method} ${url}`).toBe(403);
  }
  expect((await getJson(page, `/api/admin/businesses/${victim.id}`)).body?.business).toMatchObject({ city: victim.city, status: "active" });
  void readOnly;

  // Support can edit businesses and review requests, but not touch billing or create accounts.
  const support = await browser.newContext();
  const supportPage = await support.newPage();
  await adminSession(supportPage, ADMINS.support);
  expect((await getJson(supportPage, "/api/admin/me")).body).toMatchObject({ role: "support" });
  expect((await sendJson(supportPage, "PATCH", `/api/admin/businesses/${victim.id}`, { city: "Support City" })).status).toBe(200);
  expect((await sendJson(supportPage, "POST", "/api/admin/subscriptions/sub_support", { action: "resume", confirm: "resume" })).status).toBe(403);
  expect((await sendJson(supportPage, "POST", "/api/admin/businesses", { organizationName: "Support Create", ownerName: "x", ownerEmail: `su-${uniqueSuffix()}@example.test`, plan: "essential", sendInvite: false })).status).toBe(403);
  await support.close();

  // The refusals themselves are on the record, naming who tried what.
  const super13 = await browser.newContext();
  const superPage = await super13.newPage();
  const superAdmin = await adminSession(superPage, ADMINS.super("15"));
  const denied = await auditRows(superPage, "&outcome=denied");
  expect(denied.some((row) => row.actorEmail === ADMINS.readOnly), JSON.stringify(denied.slice(0, 5))).toBe(true);
  expect(denied.some((row) => row.actorEmail === ADMINS.support)).toBe(true);
  void superAdmin;
  await super13.close();

  // Cross-site mutation, a wrong ops secret, and a malformed identifier all fail closed.
  const crossSite = await page.request.post("/api/admin/businesses", {
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    data: {},
  });
  expect(crossSite.status()).toBe(403);
  // The `request` fixture has no session cookie, so only the bearer is judged.
  const wrongOps = await request.get("/api/admin/businesses", {
    headers: { Authorization: "Bearer wrong-secret", "x-forwarded-for": freshIp() },
  });
  expect([401, 403]).toContain(wrongOps.status());
  const rightOps = await request.get("/api/admin/businesses", {
    headers: { ...opsHeaders(), "x-forwarded-for": freshIp() },
  });
  expect(rightOps.status(), "the real ops secret is a super administrator").toBe(200);
  expect([400, 404]).toContain((await getJson(page, "/api/admin/businesses/not%20an%20id%3B%20drop")).status);
});

async function opsCustomer(page: Page) {
  const suffix = uniqueSuffix();
  const email = `victim-${suffix}@example.test`;
  await provisionOrganization(page.request, { email, organizationName: `Victim ${suffix}`, plan: "growth" });
  const list = await getJson(page, `/api/admin/businesses?q=${encodeURIComponent(`Victim ${suffix}`)}`);
  const row = (list.body?.rows as Json[])[0];
  return { id: String(row.id), city: (row.city as string | null) ?? null, email };
}

test("ADM-16 the console is usable on a phone", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();
  await adminSession(page, ADMINS.super("16"));
  const customer = await createCustomer(page, "Mobile Masonry", { city: "Charlottetown" });

  const noSidewaysScroll = async (where: string) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${where} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
  };

  await page.goto("/admin");
  await expect(h1(page)).toHaveText("Platform overview");
  const nav = page.getByRole("navigation", { name: "TradeCatch Admin" });
  const toggle = nav.getByRole("button", { name: /Admin menu/ });
  // The menu is folded away until asked for, so content is not pushed off the screen.
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(nav.getByRole("link", { name: "Audit logs" })).toBeHidden();
  await noSidewaysScroll("overview");

  for (const view of VIEWS.slice(1)) {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await nav.getByRole("link", { name: view.label, exact: true }).click();
    await expect(h1(page)).toHaveText(view.heading);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await noSidewaysScroll(view.label);
  }

  // Tables become cards; the business is reachable and its form is usable by touch.
  await page.goto("/admin/businesses");
  await page.locator("#bf-q").fill(customer.name);
  await expect(page.getByRole("table")).toBeHidden();
  const card = page.getByRole("list", { name: "Businesses" }).getByRole("listitem").filter({ hasText: customer.name });
  await expect(card).toContainText("Charlottetown");
  await card.getByRole("link", { name: customer.name }).tap();
  await expect(page.locator("#eb-city")).toHaveValue("Charlottetown");
  await page.locator("#eb-city").fill("Summerside");
  const save = page.getByRole("button", { name: "Save changes" });
  const box = await save.boundingBox();
  expect(box?.height ?? 0, "touch target height").toBeGreaterThanOrEqual(40);
  await save.tap();
  await expect(page.getByText("Saved. The change is in the audit log.")).toBeVisible();
  await noSidewaysScroll("business detail");

  // No serious accessibility violations on the busiest views at phone width.
  for (const path of ["/admin/businesses", "/admin/website-requests", "/admin/audit-logs"]) {
    await page.goto(path);
    await expect(h1(page)).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    expect(serious.map((violation) => `${violation.id}: ${violation.nodes[0]?.html}`), path).toEqual([]);
  }
  await context.close();
});

test("the console speaks French", async ({ page }) => {
  await adminSession(page, ADMINS.super("17"), "fr");
  const expected: Array<[string, string]> = [
    ["/fr/admin", "Aperçu de la plateforme"],
    ["/fr/admin/businesses", "Entreprises"],
    ["/fr/admin/subscriptions", "Abonnements"],
    ["/fr/admin/payments", "Paiements"],
    ["/fr/admin/website-requests", "Demandes de site Web"],
    ["/fr/admin/system-health", "Santé du système"],
    ["/fr/admin/audit-logs", "Journaux d’audit"],
  ];
  for (const [path, heading] of expected) {
    await page.goto(path);
    await expect(h1(page), path).toHaveText(heading);
  }
  await page.goto("/fr/admin/businesses");
  await expect(page.getByRole("button", { name: "Créer un compte client" })).toBeVisible();
});

test("every opening of the console tells a failed load from an empty one", async ({ page }) => {
  await adminSession(page, ADMINS.super("18"));
  let fail = true;
  await page.route("**/api/admin/website-requests*", (route) =>
    fail ? route.fulfill({ status: 503, json: { error: "unavailable" } }) : route.continue(),
  );
  await page.goto("/admin/website-requests");
  const failure = page.getByRole("alert").filter({ hasText: "Website requests could not be loaded." });
  await expect(failure).toBeVisible();
  await expect(page.getByText("No website requests match these filters.")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(failure).toHaveCount(0);
  await page.locator("#wf-q").fill(`nothing-matches-${uniqueSuffix()}`);
  await expect(page.getByText("Nothing to show.")).toBeVisible();
});

