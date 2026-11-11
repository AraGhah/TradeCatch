import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { workspaceSession } from "./support/workspace-session";

/**
 * The appointment calendar picker on /app/bookings (Professional plan).
 * Times depend on the real clock, so the tests read the first free day and
 * time from the page instead of hard-coding dates.
 */

const COPY = {
  en: {
    path: "/app/bookings",
    pickDate: "Choose a date",
    pickTime: /Choose a time/,
    groups: /^(Morning|Afternoon)$/,
    confirm: "Confirm Appointment",
    change: "Change Date or Time",
    customer: "Customer",
    taken: "This time is no longer available. Please select another time.",
    confirmed: "Appointment confirmed for",
    next: /Next month/,
    details: "Appointment details",
    newTime: "Choose a new date and time",
    confirmNew: "Confirm New Time",
    moved: "Appointment moved to",
  },
  fr: {
    path: "/fr/app/bookings",
    pickDate: "Choisissez une date",
    pickTime: /Choisissez une heure/,
    groups: /^(Avant-midi|Après-midi)$/,
    confirm: "Confirmer le rendez-vous",
    change: "Changer la date ou l’heure",
    customer: "Client",
    taken:
      "Cette heure n’est plus disponible. Veuillez choisir un autre moment.",
    confirmed: "Rendez-vous confirmé pour le",
    next: /Mois suivant/,
    details: "Détails du rendez-vous",
    newTime: "Choisissez une nouvelle date et heure",
    confirmNew: "Confirmer la nouvelle heure",
    moved: "Rendez-vous déplacé au",
  },
} as const;

/** Picks the first day with free times, then the first (or last) time on it. */
async function pickTime(
  page: Page,
  scope: Locator,
  next: RegExp,
  which: "first" | "last" = "first",
  copy?: { pickTime: RegExp; groups: RegExp },
) {
  const picker = scope.getByTestId("schedule-picker");
  await expect(picker.locator("button[data-date]").first()).toBeVisible();
  let day = picker.locator("button[data-date]:not([disabled])").first();
  if ((await day.count()) === 0) {
    // Nothing left this month (late on the last working day): go to the next.
    await picker.getByRole("button", { name: next }).click();
    day = picker.locator("button[data-date]:not([disabled])").first();
  }
  await expect(day).toBeVisible();
  const dayKey = (await day.getAttribute("data-date"))!;
  await day.click();
  const slots = picker.locator("button[data-slot]");
  await expect(slots.first()).toBeVisible();
  if (copy) {
    // Visible only until a time is chosen: the confirm panel then replaces the picker.
    await expect(picker.getByRole("heading", { name: copy.pickTime })).toBeVisible();
    await expect(picker.getByText(copy.groups).first()).toBeVisible();
  }
  const slot = which === "first" ? slots.first() : slots.last();
  const startAt = (await slot.getAttribute("data-slot"))!;
  await slot.click();
  return { dayKey, startAt };
}

async function organizationId(page: Page): Promise<string> {
  const me = (await (await page.request.get("/api/app/me")).json()) as {
    organization: { id: string };
  };
  return me.organization.id;
}

test("calendar picker: date, time, confirm; a taken time is refused with a clear message (en)", async ({
  page,
}) => {
  const c = COPY.en;
  await workspaceSession(page, "en", "professional");
  await page.goto(c.path);
  await expect(page.getByRole("heading", { name: c.pickDate })).toBeVisible();
  // The old dropdown of times is gone.
  await expect(page.getByLabel("Available time")).toHaveCount(0);

  const { dayKey, startAt } = await pickTime(
    page,
    page.locator("main"),
    c.next,
    "first",
    c,
  );

  // The customer's name is needed before the appointment can be confirmed.
  const confirm = page.getByRole("button", { name: c.confirm });
  await expect(confirm).toBeDisabled();
  await page
    .getByRole("textbox", { name: c.customer, exact: true })
    .fill("Calendar Customer");
  await expect(confirm).toBeEnabled();
  const panel = page.getByTestId("confirm-panel");
  await expect(panel).toContainText("Calendar Customer");

  // "Change Date or Time" goes back to the same month and day.
  await page.getByRole("button", { name: c.change }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("schedule-picker")).toBeVisible();
  await page.locator(`button[data-slot="${startAt}"]`).click();
  await expect(panel).toBeVisible();

  // The time is taken while the confirm panel is open: clear message, fresh times.
  await page.route("**/api/businesses/*/appointments", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({
      status: 409,
      json: {
        ok: false,
        confirmed: false,
        reason: "conflict",
        error: c.taken,
        alternatives: [],
      },
    });
  });
  await confirm.click();
  await expect(
    page.getByRole("alert").filter({ hasText: c.taken }),
  ).toBeVisible();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("schedule-picker")).toBeVisible();
  await page.unroute("**/api/businesses/*/appointments");

  // Pick again and confirm for real.
  await page.locator(`button[data-slot="${startAt}"]`).click();
  await page.getByRole("button", { name: c.confirm }).click();
  await expect(
    page.getByRole("status").filter({ hasText: c.confirmed }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Calendar Customer/ }),
  ).toBeVisible();

  // The server itself refuses a second booking of the same time (HTTP 409)...
  const id = await organizationId(page);
  const again = await page.request.post(`/api/businesses/${id}/appointments`, {
    data: { startAt, customerName: "Second Customer" },
  });
  expect(again.status()).toBe(409);
  expect(await again.json()).toMatchObject({
    ok: false,
    confirmed: false,
    reason: "conflict",
    error: c.taken,
  });
  // ...and the calendar no longer offers it.
  const month = (await (
    await page.request.get(
      `/api/businesses/${id}/availability?month=${dayKey.slice(0, 7)}`,
    )
  ).json()) as { days: Record<string, { startAt: string }[]> };
  expect(
    (month.days[dayKey] ?? []).some((slot) => slot.startAt === startAt),
  ).toBe(false);
});

test("calendar picker: rescheduling uses the same calendar and confirm step (en)", async ({
  page,
}) => {
  const c = COPY.en;
  await workspaceSession(page, "en", "professional");
  const id = await organizationId(page);
  const open = (await (
    await page.request.get(`/api/businesses/${id}/availability?days=1`)
  ).json()) as { days: Record<string, { startAt: string }[]> };
  const firstDay = Object.keys(open.days).sort()[0];
  test.skip(!firstDay, "no free day this month at the moment this ran");
  const booked = await page.request.post(`/api/businesses/${id}/appointments`, {
    data: {
      startAt: open.days[firstDay!]![0]!.startAt,
      customerName: "Move Me",
    },
  });
  expect(booked.status()).toBe(201);

  await page.goto(c.path);
  await page.getByRole("button", { name: /Move Me/ }).click();
  const details = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: c.details }) });
  await details.getByRole("button", { name: "Reschedule", exact: true }).click();
  await expect(
    details.getByRole("heading", { name: c.newTime }),
  ).toBeVisible();
  // Last time of the first free day: always different from the booked first time.
  await pickTime(page, details, c.next, "last");
  await details.getByRole("button", { name: c.confirmNew }).click();
  await expect(
    page.getByRole("status").filter({ hasText: c.moved }),
  ).toBeVisible();
});

test("calendar picker is usable on a phone and passes the accessibility scan (en)", async ({
  page,
}) => {
  const c = COPY.en;
  await page.setViewportSize({ width: 375, height: 800 });
  await workspaceSession(page, "en", "professional");
  await page.goto(c.path);
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
  const form = "section[aria-labelledby='add-appointment-title']";
  const scan = async () =>
    (await new AxeBuilder({ page }).include(form).analyze()).violations;

  // The month grid: tap targets are at least 44px and nothing scrolls sideways.
  const grid = page.getByTestId("schedule-picker");
  await expect(grid.locator("button[data-date]").first()).toBeVisible();
  const day = grid.locator("button[data-date]:not([disabled])").first();
  expect((await day.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await overflow()).toBeLessThanOrEqual(0);

  // Date and time chosen: scan, then the confirm panel: scan again.
  await pickTime(page, page.locator("main"), c.next);
  await page
    .getByRole("textbox", { name: c.customer, exact: true })
    .fill("Phone Customer");
  await expect(page.getByTestId("confirm-panel")).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  expect(await scan()).toEqual([]);
  await page.getByRole("button", { name: c.change }).click();
  await expect(page.getByTestId("schedule-picker")).toBeVisible();
  expect(await scan()).toEqual([]);
});

test("calendar picker is fully translated (fr)", async ({ page }) => {
  const c = COPY.fr;
  const problems: string[] = [];
  page.on("console", (message) => {
    if (/MISSING_MESSAGE|INVALID_MESSAGE/.test(message.text()))
      problems.push(message.text());
  });
  await workspaceSession(page, "fr", "professional");
  await page.goto(c.path);
  await expect(page.getByRole("heading", { name: c.pickDate })).toBeVisible();
  await pickTime(page, page.locator("main"), c.next, "first", c);
  await page
    .getByRole("textbox", { name: c.customer, exact: true })
    .fill("Client Calendrier");
  await expect(page.getByRole("button", { name: c.confirm })).toBeEnabled();
  await expect(page.getByRole("button", { name: c.change })).toBeVisible();
  expect(problems).toEqual([]);
});
