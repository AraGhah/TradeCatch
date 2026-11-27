import assert from "node:assert/strict";
import { test } from "node:test";
import { googleCalendarPilotAllowed } from "../../src/product/scheduling/availability";
import { DEFAULT_DEMO_FEATURES } from "../../src/product/demo/types";
import { createGoogleClient } from "../../src/product/scheduling/gcal/client";

test("Google Calendar enrollment fails closed and cannot be unlocked by a plan or editable flags alone", () => {
  const org = {
    id: "pilot-a",
    status: "active" as const,
    accountType: "production" as const,
    plan: "professional" as const,
    features: DEFAULT_DEMO_FEATURES,
  };
  assert.equal(googleCalendarPilotAllowed(org, "pilot-a, pilot-b"), true);
  for (const allow of ["", "*", "pilot-aa", "pilot-b"])
    assert.equal(googleCalendarPilotAllowed(org, allow), false);
  for (const patch of [
    { status: "suspended" as const },
    { plan: "starter" as const },
    { plan: "essential" as const },
    { accountType: "demo" as const },
    { features: { ...DEFAULT_DEMO_FEATURES, appointmentBooking: false } },
  ]) {
    assert.equal(
      googleCalendarPilotAllowed({ ...org, ...patch }, "pilot-a"),
      false,
    );
  }
  assert.equal(googleCalendarPilotAllowed(null, "pilot-a"), false);
  // Customers sold the earlier Growth plan keep appointments and stay eligible.
  assert.equal(
    googleCalendarPilotAllowed({ ...org, plan: "growth" as const }, "pilot-a"),
    true,
  );
});

test("Google client speaks the Calendar contract: list, create, update and delete (mock provider, not live proof)", async () => {
  const calls: { url: string; method: string; body?: string }[] = [];
  const client = createGoogleClient({
    tokens: {
      accessToken: "test",
      refreshToken: "test",
      expiresAt: "2099-01-01T00:00:00Z",
    },
    fetchImpl: (async (url: URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body as string | undefined,
      });
      return Response.json(
        String(url).includes("calendarList")
          ? { items: [{ id: "business@example.invalid", primary: true, accessRole: "owner", summary: "Work" }] }
          : { id: "test-event", etag: "\"1\"" },
      );
    }) as typeof fetch,
  });
  const calendars = await client.listCalendars();
  assert.ok(calendars.ok);
  assert.equal(calendars.accountEmail, "business@example.invalid");
  const body = { id: "test-event", summary: "Test visit" };
  assert.ok((await client.insertEvent("business@example.invalid", body)).ok);
  assert.ok((await client.patchEvent("business@example.invalid", "test-event", body)).ok);
  // A DELETE answers with no body.
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "POST", "PATCH"],
  );
  assert.ok(calls[1].url.includes("business%40example.invalid"));
  // Nobody is emailed by Google because TradeCatch wrote to a calendar.
  assert.ok(calls[1].url.includes("sendUpdates=none"));
});
