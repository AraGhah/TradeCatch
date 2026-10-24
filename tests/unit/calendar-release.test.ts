import assert from "node:assert/strict";
import { test } from "node:test";
import { googleCalendarPilotAllowed } from "../../src/product/scheduling/availability";
import { DEFAULT_DEMO_FEATURES } from "../../src/product/demo/types";
import { createGoogleCalendarPort } from "../../src/product/scheduling/google";
import type { ScheduleAppointment } from "../../src/product/scheduling/types";

test("Google Calendar enrollment fails closed and cannot be unlocked by a plan or editable flags alone", () => {
  const org = {
    id: "pilot-a",
    status: "active" as const,
    accountType: "pilot" as const,
    plan: "growth" as const,
    features: DEFAULT_DEMO_FEATURES,
  };
  assert.equal(googleCalendarPilotAllowed(org, "pilot-a, pilot-b"), true);
  for (const allow of ["", "*", "pilot-aa", "pilot-b"])
    assert.equal(googleCalendarPilotAllowed(org, allow), false);
  for (const patch of [
    { status: "suspended" as const },
    { plan: "starter" as const },
    { accountType: "production" as const },
    { accountType: "demo" as const },
    { features: { ...DEFAULT_DEMO_FEATURES, appointmentBooking: false } },
  ]) {
    assert.equal(
      googleCalendarPilotAllowed({ ...org, ...patch }, "pilot-a"),
      false,
    );
  }
  assert.equal(googleCalendarPilotAllowed(null, "pilot-a"), false);
});

test("Google adapter implements free/busy and event create, update and delete contracts (mock provider, not live proof)", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; method: string }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    return Response.json(
      String(url).endsWith("freeBusy")
        ? { calendars: { "business@example.invalid": { busy: [] } } }
        : { id: "test-event" },
    );
  };
  try {
    const port = createGoogleCalendarPort({
      tokens: {
        accessToken: "test",
        refreshToken: "test",
        expiresAt: "2099-01-01T00:00:00Z",
      },
      calendarId: "business@example.invalid",
    });
    const appointment = {
      serviceName: "Test visit",
      startAt: "2026-10-26T14:00:00Z",
      endAt: "2026-10-26T15:00:00Z",
      timezone: "America/Toronto",
    } as ScheduleAppointment;
    assert.deepEqual(
      await port.freeBusy(appointment.startAt, appointment.endAt),
      [],
    );
    assert.deepEqual(await port.createEvent(appointment), { id: "test-event" });
    assert.deepEqual(await port.updateEvent("test-event", appointment), {
      ok: true,
    });
    assert.deepEqual(await port.deleteEvent("test-event"), { ok: true });
    assert.deepEqual(
      calls.map((call) => call.method),
      ["POST", "POST", "PATCH", "DELETE"],
    );
    assert.ok(calls[1].url.includes("business%40example.invalid"));
  } finally {
    globalThis.fetch = original;
  }
});
