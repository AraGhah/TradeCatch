import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { FakeGoogleCalendar } from "./support/fake-google-calendar";
import { startFakeGoogleServer } from "./support/fake-google-server";
import { signInAs } from "./support/workspace-session";

/**
 * KAN-22 end to end: Google Calendar connection and synchronization against the
 * real app (production build, real routes, sessions, cookies, token sealing and
 * the real sync engine) with only Google itself substituted by
 * tests/support/fake-google-calendar, served over HTTP.
 *
 * Covers the browser- and HTTP-visible acceptance criteria: SYNC-01 connect,
 * SYNC-02 denied, SYNC-13 other business, SYNC-16 Essential plan, SYNC-17
 * persistence, and the dashboard side of SYNC-04..08, 12 and 14. The sync
 * engine's edge cases (SYNC-03..18) run in tests/unit/gcal-scenarios.ts on both
 * the memory and the real SQL store.
 *
 * Businesses named "E2E Google Calendar ..." are enrolled by the local harness
 * only (src/product/scheduling/availability.ts); every other rule, including
 * the plan, still applies to them.
 */

const PORT = Number(process.env.TRADECATCH_GCAL_E2E_PORT || 4011);
const OPS = {
  Authorization: "Bearer tradecatch-e2e-ops-secret-not-for-production",
  "X-Ops-Actor": "playwright-gcal",
};
const GOOGLE_ACCOUNT = "calendar-owner@example.test";
const CREW = "Crew calendar";

const google = new FakeGoogleCalendar();
let server: Awaited<ReturnType<typeof startFakeGoogleServer>>;

type Person = {
  email: string;
  clientIp: string;
  orgId: string;
  page: Page;
  context: BrowserContext;
};

async function signUp(
  browser: Browser,
  label: string,
  plan: "professional" | "essential",
): Promise<Person> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = `gcal-${label}-${randomUUID()}@example.invalid`;
  const clientIp = `2001:db8:${randomUUID().replaceAll("-", "").match(/.{4}/g)!.slice(0, 6).join(":")}`;
  const provision = await page.request.post("/api/missed-call/ops/provision-organization", {
    headers: OPS,
    data: {
      email,
      organizationName: `E2E Google Calendar ${label}`,
      ownerName: `${label} Owner`,
      locale: "en",
      plan,
    },
  });
  expect(provision.status()).toBe(201);
  const body = (await provision.json()) as { organization: { id: string } };
  await signInAs(page, email, clientIp, "en");
  return { email, clientIp, orgId: body.organization.id, page, context };
}

/** A weekday a few days out, at a time inside the default opening hours in any North American season. */
function bookableStart(hourUtc: number, daysAhead = 5) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date.toISOString();
}

const settings = (path = "") => `${path}/app/settings/calendar`;
const panel = (page: Page) => page.getByTestId("calendar-availability");
const status = (page: Page) => page.getByTestId("gcal-status");

async function api<T = Record<string, unknown>>(
  page: Page,
  method: "get" | "post",
  path: string,
  data?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await page.request[method](path, data === undefined ? undefined : { data });
  return { status: response.status(), body: (await response.json().catch(() => ({}))) as T };
}

async function book(person: Person, startAt: string, name = "Alice Tremblay") {
  return api<{ confirmed?: boolean; appointment?: { id: string; calendarEventId?: string }; error?: string }>(
    person.page,
    "post",
    `/api/businesses/${person.orgId}/appointments`,
    {
      startAt,
      customerName: name,
      customerPhoneE164: "+15145550101",
      serviceAddress: "12 rue Privée, Montréal",
      idempotencyKey: randomUUID(),
    },
  );
}

test.describe.configure({ mode: "serial" });

test.describe("Google Calendar integration", () => {
  let alice: Person;
  let bob: Person;
  let essential: Person;
  const slot = { first: "", second: "", third: "" };
  let appointmentId = "";

  test.beforeAll(async ({ browser }) => {
    server = await startFakeGoogleServer(google, PORT);
    google.account(GOOGLE_ACCOUNT);
    google.addCalendar(GOOGLE_ACCOUNT, "crew@group.calendar.example", CREW);
    google.consent = { mode: "allow", email: GOOGLE_ACCOUNT };
    alice = await signUp(browser, "Alice", "professional");
    bob = await signUp(browser, "Bob", "professional");
    essential = await signUp(browser, "Essential", "essential");
    slot.first = bookableStart(15);
    slot.second = bookableStart(18);
    slot.third = bookableStart(15, 8);
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const person of [alice, bob, essential]) await person?.context.close();
  });

  test("SYNC-01 an owner connects Google Calendar with least-privilege access and chooses a calendar", async () => {
    const { page } = alice;
    await page.goto(settings());
    await expect(status(page)).toHaveText("Simulated");
    await expect(page.getByTestId("gcal-sync-now")).toHaveCount(0);

    await page.getByTestId("gcal-connect").click();
    await expect(page.getByTestId("gcal-banner")).toContainText("Choose which calendar");
    // What Google was asked for: event access only, offline, with a signed state.
    const asked = google.authRequests.at(-1)!.params;
    const scopes = (asked.get("scope") ?? "").split(" ");
    expect(scopes.sort()).toEqual(
      [
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        "https://www.googleapis.com/auth/calendar.events",
      ].sort(),
    );
    expect(asked.get("access_type")).toBe("offline");
    expect(asked.get("response_type")).toBe("code");
    expect(asked.get("state")?.length).toBeGreaterThan(20);

    // The half-finished connection survives a refresh (the redirect result is gone, the step is not).
    await page.reload();
    await expect(status(page)).toHaveText("Choose a calendar");
    await expect(page.getByTestId("gcal-account")).toHaveText(GOOGLE_ACCOUNT);
    const select = page.getByTestId("gcal-calendar-select");
    await expect(select.locator("option")).toHaveText([GOOGLE_ACCOUNT, CREW]);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="calendar-availability"]').analyze()).violations,
    ).toEqual([]);

    await select.selectOption({ label: CREW });
    await page.getByTestId("gcal-choose").click();
    await expect(status(page)).toHaveText("Connected");
    await expect(page.getByTestId("gcal-account")).toHaveText(GOOGLE_ACCOUNT);
    await expect(page.getByTestId("gcal-calendar-name")).toHaveText(CREW);
    await expect(page.getByTestId("gcal-last-sync")).not.toHaveText("Not yet");
    await expect(panel(page)).toContainText("Instant updates are on");
    expect(google.channels.size).toBe(1);
    // The browser was never given a token, a refresh token or Google's client secret.
    const html = await page.content();
    for (const secret of ["rt:" + GOOGLE_ACCOUNT, "at:" + GOOGLE_ACCOUNT, "e2e-calendar-client-secret"]) {
      expect(html).not.toContain(secret);
    }
  });

  test("SYNC-17 the connection, calendar and last sync persist across a refresh and a new login", async ({ browser }) => {
    const { page } = alice;
    const lastSync = await page.getByTestId("gcal-last-sync").innerText();
    await page.reload();
    await expect(status(page)).toHaveText("Connected");
    await expect(page.getByTestId("gcal-calendar-name")).toHaveText(CREW);
    await expect(page.getByTestId("gcal-last-sync")).toHaveText(lastSync);

    // A brand new session for the same owner: nothing is held in the browser.
    const context = await browser.newContext();
    const fresh = await context.newPage();
    await signInAs(fresh, alice.email, alice.clientIp, "en");
    await fresh.goto(settings());
    await expect(status(fresh)).toHaveText("Connected");
    await expect(fresh.getByTestId("gcal-account")).toHaveText(GOOGLE_ACCOUNT);
    await expect(fresh.getByTestId("gcal-calendar-name")).toHaveText(CREW);
    await expect(fresh.getByTestId("gcal-last-sync")).toHaveText(lastSync);
    await fresh.goto(settings("/fr"));
    await expect(status(fresh)).toHaveText("Connecté");
    await expect(panel(fresh)).toContainText("Dernière synchronisation réussie");
    await context.close();
  });

  test("SYNC-04/05/06 a booking creates, moves and removes the Google event, without customer details", async () => {
    const booked = await book(alice, slot.first);
    expect(booked.status).toBe(201);
    expect(booked.body.confirmed).toBe(true);
    appointmentId = booked.body.appointment!.id;

    const events = google.tradecatchEvents(GOOGLE_ACCOUNT, "crew@group.calendar.example");
    expect(events).toHaveLength(1);
    expect(events[0]!.start.dateTime).toBe(slot.first);
    // Stored in UTC, labelled in the business's own zone (SYNC-15), whatever that zone is.
    const business = await api<{ timezone: string; calendarMode: string }>(
      alice.page,
      "get",
      `/api/businesses/${alice.orgId}/appointments`,
    );
    expect(business.body.calendarMode).toBe("google");
    expect(business.body.timezone).toMatch(/^[A-Za-z]+\/[A-Za-z_]+/);
    expect(events[0]!.start.timeZone).toBe(business.body.timezone);
    expect(events[0]!.extendedProperties?.private?.tcAppointmentId).toBe(appointmentId);
    const body = JSON.stringify(events[0]);
    for (const personal of ["Alice", "5145550101", "Privée"]) expect(body).not.toContain(personal);
    // Nobody is invited or emailed by Google because of TradeCatch.
    expect(
      google.calls.some((c) => c.method === "POST" && /\/events$/.test(c.path) && c.query.includes("sendUpdates=none")),
    ).toBe(true);

    const moved = await api(alice.page, "post", `/api/businesses/${alice.orgId}/appointments/${appointmentId}/reschedule`, {
      startAt: slot.second,
    });
    expect(moved.status).toBe(200);
    const after = google.tradecatchEvents(GOOGLE_ACCOUNT, "crew@group.calendar.example");
    expect(after).toHaveLength(1);
    expect(after[0]!.start.dateTime).toBe(slot.second);

    const canceled = await api(alice.page, "post", `/api/businesses/${alice.orgId}/appointments/${appointmentId}/cancel`, {
      reason: "customer called",
    });
    expect(canceled.status).toBe(200);
    expect(google.liveEvents(GOOGLE_ACCOUNT, "crew@group.calendar.example")).toHaveLength(0);
    const list = await api<{ appointments: { id: string; status: string }[] }>(
      alice.page,
      "get",
      `/api/businesses/${alice.orgId}/appointments`,
    );
    expect(list.body.appointments.find((a) => a.id === appointmentId)?.status).toBe("canceled");
  });

  test("SYNC-03/09 Google's change notification is authenticated, and the owner's events block booking", async () => {
    const channel = google.latestChannel()!;
    const notify = (token: string, message: number) =>
      alice.page.request.post("/api/webhooks/google-calendar", {
        headers: {
          "x-goog-channel-id": channel.id,
          "x-goog-channel-token": token,
          "x-goog-resource-state": "exists",
          "x-goog-message-number": String(message),
        },
      });
    expect((await notify("wrong-token-0123456789abcdef", 1)).status()).toBe(401);
    // Nothing identifies a business except the channel and its secret.
    const strangers = await alice.page.request.post("/api/webhooks/google-calendar", {
      headers: {
        "x-goog-channel-id": "some-other-business-channel-0123",
        "x-goog-channel-token": channel.token,
        "x-goog-resource-state": "exists",
      },
    });
    expect(strangers.status()).toBe(401);

    google.ownerAdds(GOOGLE_ACCOUNT, {
      calendarId: "crew@group.calendar.example",
      start: slot.third,
      end: new Date(Date.parse(slot.third) + 3_600_000).toISOString(),
      summary: "Dentist (private)",
    });
    const accepted = await notify(channel.token, 5);
    expect(accepted.status()).toBe(200);
    expect(((await accepted.json()) as { status: string }).status).toBe("synced");
    // The same message again does no further work.
    const reads = google.count("GET /calendar/v3/calendars");
    const repeated = await notify(channel.token, 5);
    expect(((await repeated.json()) as { status: string }).status).toBe("duplicate");
    expect(google.count("GET /calendar/v3/calendars")).toBe(reads);

    const taken = await book(alice, slot.third, "Should not fit");
    expect(taken.status).toBe(409);
    expect(google.tradecatchEvents(GOOGLE_ACCOUNT, "crew@group.calendar.example")).toHaveLength(1);
  });

  test("SYNC-12 a Google outage never blocks booking and shows up on the dashboard, then clears", async () => {
    const { page } = alice;
    const exists = google.tradecatchEvents(GOOGLE_ACCOUNT, "crew@group.calendar.example").length;
    google.down = true;
    const booked = await book(alice, slot.second, "During outage");
    expect(booked.status).toBe(201);
    expect(booked.body.confirmed).toBe(true);
    expect(google.tradecatchEvents(GOOGLE_ACCOUNT, "crew@group.calendar.example")).toHaveLength(exists);

    await page.goto(settings());
    await expect(page.getByTestId("gcal-pending")).toContainText("1 change is waiting");
    await expect(page.getByTestId("gcal-problem")).toContainText("Google could not be reached");
    await expect(status(page)).toHaveText("Connected");

    google.down = false;
    await page.getByTestId("gcal-sync-now").click();
    await expect(page.getByTestId("gcal-uptodate")).toBeVisible();
    await expect(page.getByTestId("gcal-pending")).toHaveCount(0);
    await expect(page.getByTestId("gcal-problem")).toHaveCount(0);
    expect(google.tradecatchEvents(GOOGLE_ACCOUNT, "crew@group.calendar.example")).toHaveLength(exists + 1);
    appointmentId = booked.body.appointment!.id;
  });

  test("SYNC-07/08 edits and deletions made in Google are flagged, never applied to the appointment", async () => {
    const { page } = alice;
    const eventId = google
      .tradecatchEvents(GOOGLE_ACCOUNT, "crew@group.calendar.example")
      .find((e) => e.status !== "cancelled" && e.start.dateTime === slot.second)!.id;

    google.ownerMoves(
      GOOGLE_ACCOUNT,
      eventId,
      bookableStart(20, 6),
      new Date(Date.parse(bookableStart(20, 6)) + 3_600_000).toISOString(),
      "crew@group.calendar.example",
    );
    await page.goto(settings());
    await page.getByTestId("gcal-sync-now").click();
    await expect(page.getByTestId("gcal-attention")).toContainText("moved in Google");
    let appointment = await api<{ appointment?: { startAt: string; status: string } }>(
      page,
      "get",
      `/api/businesses/${alice.orgId}/appointments/${appointmentId}`,
    );
    expect(appointment.body.appointment?.startAt).toBe(slot.second);
    expect(appointment.body.appointment?.status).toBe("confirmed");

    google.ownerDeletes(GOOGLE_ACCOUNT, eventId, "crew@group.calendar.example");
    await page.getByTestId("gcal-sync-now").click();
    await expect(page.getByTestId("gcal-attention")).toContainText("deleted in Google");
    appointment = await api(page, "get", `/api/businesses/${alice.orgId}/appointments/${appointmentId}`);
    expect(appointment.body.appointment?.status).toBe("confirmed");
    // Nothing is written back and the event is not recreated.
    google.clearCalls();
    await page.getByTestId("gcal-sync-now").click();
    await expect(page.getByTestId("gcal-attention")).toContainText("deleted in Google");
    expect(google.calls.filter((c) => ["POST", "PATCH", "DELETE"].includes(c.method) && c.path.includes("/events"))).toHaveLength(0);
  });

  test("owner settings: customer details are opt-in and the choice is saved", async () => {
    const { page } = alice;
    await page.goto(settings());
    await expect(page.getByLabel("Service only. No customer name, phone or address.")).toBeChecked();
    await expect(page.getByTestId("gcal-settings-save")).toBeDisabled();
    await page.getByLabel("Keep the event, marked as canceled").check();
    await page.getByTestId("gcal-settings-save").click();
    await expect(page.getByTestId("gcal-banner")).toContainText("Saved");
    await page.reload();
    await expect(page.getByLabel("Keep the event, marked as canceled")).toBeChecked();
    await page.getByLabel("Remove the event from Google Calendar").check();
    await page.getByTestId("gcal-settings-save").click();
    await expect(page.getByTestId("gcal-banner")).toContainText("Saved");
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="calendar-availability"]').analyze()).violations,
    ).toEqual([]);
  });

  test("SYNC-02 an owner who refuses access on Google's screen is returned safely, with nothing stored", async () => {
    const { page } = bob;
    google.consent = { mode: "deny", email: GOOGLE_ACCOUNT };
    const exchanges = google.count("POST /token");
    await page.goto(settings());
    await page.getByTestId("gcal-connect").click();
    await expect(page.getByTestId("gcal-banner")).toContainText("access was not allowed");
    await expect(page.getByTestId("gcal-banner")).toHaveAttribute("role", "alert");
    await expect(status(page)).toHaveText("Simulated");
    await expect(page.getByTestId("gcal-connect")).toBeVisible();
    expect(google.count("POST /token")).toBe(exchanges);
    expect((await api<{ calendar: { status: string } }>(page, "get", `/api/businesses/${bob.orgId}/calendar/status`)).body.calendar.status).toBe("simulated");
    google.consent = { mode: "allow", email: GOOGLE_ACCOUNT };
    // A refused permission box (access granted without event access) is rejected and revoked.
    google.grantScope = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
    await page.getByTestId("gcal-connect").click();
    await expect(page.getByTestId("gcal-banner")).toContainText("permission to manage events was not granted");
    await expect(status(page)).toHaveText("Simulated");
    expect(google.revokedTokens.length).toBeGreaterThan(0);
    google.grantScope = null;
  });

  test("SYNC-13 another business can neither read, change nor disconnect this calendar, nor reuse its sign-in link", async () => {
    const before = await api<{ calendar: { status: string; calendarId: string } }>(
      alice.page,
      "get",
      `/api/businesses/${alice.orgId}/calendar/status`,
    );
    expect(before.body.calendar.status).toBe("connected");

    for (const [method, path, data] of [
      ["get", "status", undefined],
      ["get", "sync", undefined],
      ["get", "calendars", undefined],
      ["post", "sync", { action: "retry" }],
      ["post", "connect", undefined],
      ["post", "disconnect", undefined],
    ] as const) {
      const denied = await api(bob.page, method, `/api/businesses/${alice.orgId}/calendar/${path}`, data);
      expect([403, 404], `${method} ${path}`).toContain(denied.status);
    }
    const stolen = await api(bob.page, "post", `/api/businesses/${alice.orgId}/appointments`, { startAt: slot.second });
    expect([403, 404]).toContain(stolen.status);

    // A connect link minted for Alice, opened in Bob's session, attaches nothing.
    const minted = await api<{ url: string }>(alice.page, "post", `/api/businesses/${alice.orgId}/calendar/connect`);
    const state = new URL(minted.body.url).searchParams.get("state")!;
    await bob.page.goto(
      `/api/calendar/oauth/callback?code=${encodeURIComponent(google.codeFor(GOOGLE_ACCOUNT))}&state=${encodeURIComponent(state)}`,
    );
    await expect(bob.page.getByTestId("gcal-banner")).toContainText("do not have permission");
    await expect(status(bob.page)).toHaveText("Simulated");

    // Alice is untouched.
    const after = await api<{ calendar: { status: string; calendarId: string } }>(
      alice.page,
      "get",
      `/api/businesses/${alice.orgId}/calendar/status`,
    );
    expect(after.body.calendar).toMatchObject({ status: "connected", calendarId: before.body.calendar.calendarId });
  });

  test("SYNC-16 the Essential plan cannot use Google Calendar, and Google is never contacted", async () => {
    const calls = google.calls.length;
    await essential.page.goto(settings());
    await expect(essential.page.getByTestId("gcal-connect")).toHaveCount(0);
    await expect(essential.page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const [method, path, data] of [
      ["get", "status", undefined],
      ["get", "calendars", undefined],
      ["post", "connect", undefined],
      ["post", "sync", { action: "retry" }],
    ] as const) {
      const denied = await api(essential.page, method, `/api/businesses/${essential.orgId}/calendar/${path}`, data);
      expect(denied.status, `${method} ${path}`).toBe(403);
    }
    // Even a callback carrying a perfectly valid code cannot attach a calendar.
    await essential.page.goto(`/api/calendar/oauth/callback?code=${encodeURIComponent(google.codeFor(GOOGLE_ACCOUNT))}&state=garbage`);
    expect(google.calls.length).toBe(calls);
  });

  test("SYNC-14 disconnecting revokes access at Google, stops all sync and keeps every appointment", async () => {
    const { page } = alice;
    const before = await api<{ appointments: { id: string; status: string }[] }>(
      page,
      "get",
      `/api/businesses/${alice.orgId}/appointments`,
    );
    const kept = before.body.appointments.filter((a) => a.status === "confirmed").map((a) => a.id);
    expect(kept.length).toBeGreaterThan(0);
    const channel = google.latestChannel()!;

    await page.goto(settings());
    await page.getByTestId("gcal-disconnect").click();
    await expect(page.getByTestId("gcal-disconnect-confirm")).toContainText("Your appointments stay");
    await page.getByTestId("gcal-disconnect-yes").click();
    await expect(status(page)).toHaveText("Disconnected");
    await expect(page.getByTestId("gcal-banner")).toContainText("appointments were kept");
    await expect(page.getByTestId("gcal-connect")).toBeVisible();

    expect(google.revokedTokens.some((token) => token.startsWith("rt:"))).toBe(true);
    expect(google.stoppedChannels).toContain(channel.id);

    const after = await api<{ appointments: { id: string; status: string }[] }>(
      page,
      "get",
      `/api/businesses/${alice.orgId}/appointments`,
    );
    expect(after.body.appointments.filter((a) => a.status === "confirmed").map((a) => a.id).sort()).toEqual(kept.sort());

    // The scheduled pass makes no call to Google for a disconnected business, and a late
    // notification for the old channel is refused.
    google.clearCalls();
    const tick = await page.request.post("/api/calendar/google/tick", { headers: OPS });
    expect(tick.status()).toBe(200);
    expect(google.calls.filter((c) => c.path.startsWith("/calendar/v3"))).toHaveLength(0);
    const late = await page.request.post("/api/webhooks/google-calendar", {
      headers: {
        "x-goog-channel-id": channel.id,
        "x-goog-channel-token": channel.token,
        "x-goog-resource-state": "exists",
        "x-goog-message-number": "99",
      },
    });
    expect(late.status()).toBe(401);
    expect(google.calls.filter((c) => c.path.startsWith("/calendar/v3"))).toHaveLength(0);
  });
});
