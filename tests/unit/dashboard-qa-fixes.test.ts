import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tidySentence } from "../../src/components/app/schedule-picker-utils";
import { createMemoryCrmStore } from "../../src/product/crm/memory-store";
import { parsePhoneInput } from "../../src/product/crm/phone";
import {
  cleanProblemText,
  searchFold,
} from "../../src/product/crm/record-quality";
import { createCrmService } from "../../src/product/crm/service";
import {
  isPracticeCall,
  ownerVisibleCalls,
} from "../../src/product/receptionist/call-history";
import { defaultGreetings } from "../../src/product/receptionist/config";
import { extractPhoneE164 } from "../../src/product/receptionist/nlu";
import { phrase } from "../../src/product/receptionist/prompts";
import type { CallSession } from "../../src/product/receptionist/types";
import {
  createSchedulingService,
  createSimulatedCalendar,
  SchedulingError,
} from "../../src/product/scheduling/service";
import {
  rulesProblem,
  usableTimeZone,
} from "../../src/product/scheduling/slots";
import { createMemorySchedulingStore } from "../../src/product/scheduling/store";
import { createSupportService } from "../../src/product/support/service";
import { createMemorySupportStore } from "../../src/product/support/store";

/**
 * Regression tests for the dashboard QA report of 2026-11-10: each test is one
 * bug an owner could hit by clicking through the account.
 */

const NOW = new Date("2026-10-16T12:00:00.000Z");
const MONDAY_10 = "2026-10-19T14:00:00.000Z";
const MONDAY_13 = "2026-10-19T17:00:00.000Z";
const ORG = "org_qa";

function scheduling(now: () => Date = () => NOW) {
  const store = createMemorySchedulingStore();
  const notices: { kind: string; refId: string }[] = [];
  const service = createSchedulingService({
    store,
    now,
    calendar: async () => createSimulatedCalendar(),
    notify: async (input) => {
      notices.push({ kind: input.kind, refId: input.refId });
    },
  });
  return { service, store, notices };
}

async function codeOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof SchedulingError, "a SchedulingError is thrown");
    return error.code;
  }
  assert.fail("expected the call to be refused");
}

describe("availability settings (H2)", () => {
  it("refuses a timezone, hours or a holiday that are not real", async () => {
    const { service } = scheduling();
    const rules = await service.getRules(ORG);
    assert.equal(
      await codeOf(() => service.saveRules({ ...rules, timezone: "Mars/Olympus" })),
      "invalid_timezone",
    );
    for (const hours of [
      { open: "abc", close: "17:00" },
      { open: "08:00", close: "25:99" },
      { open: "17:00", close: "08:00" },
    ]) {
      assert.equal(
        await codeOf(() =>
          service.saveRules({ ...rules, days: { ...rules.days, "1": hours } }),
        ),
        "invalid_hours",
      );
    }
    assert.equal(
      await codeOf(() => service.saveRules({ ...rules, holidays: ["2026-02-30"] })),
      "invalid_holiday",
    );
    // Nothing above was stored: the calendar still has its Monday openings.
    const open = await service.availability({
      organizationId: ORG,
      from: "2026-10-19T13:00:00.000Z",
      until: "2026-10-19T18:00:00.000Z",
    });
    assert.equal(open.slots.some((slot) => slot.startAt === MONDAY_10), true);
  });

  it("keeps the calendar working when a bad timezone is already stored", async () => {
    const { service, store } = scheduling();
    const rules = await service.getRules(ORG);
    await store.saveRules({ ...rules, timezone: "Not/AZone" });
    const open = await service.availability({
      organizationId: ORG,
      from: "2026-10-19T13:00:00.000Z",
      until: "2026-10-19T18:00:00.000Z",
    });
    assert.ok(open.slots.length > 0);
    assert.equal(usableTimeZone("Not/AZone"), "America/Toronto");
    assert.equal(
      rulesProblem({ timezone: "America/Toronto", days: {}, holidays: [] }),
      null,
    );
  });
});

describe("pending requests (H4, M11)", () => {
  async function pendingRequest() {
    const ctx = scheduling();
    const service = await ctx.service.saveService({
      id: "svc_estimate",
      organizationId: ORG,
      name: "On-site estimate",
      durationMinutes: 60,
      bookingMode: "manual_approval",
      eligibleTechnicianIds: [],
      active: true,
    });
    const requested = await ctx.service.book({
      organizationId: ORG,
      serviceId: service.id,
      startAt: MONDAY_10,
      customerName: "Marie Tremblay",
      source: "dashboard",
    });
    assert.equal(requested.confirmed, false);
    assert.equal(requested.appointment?.status, "pending");
    return { ...ctx, appointmentId: requested.appointment!.id };
  }

  it("announces a request as a request, never as a confirmation", async () => {
    const { notices, appointmentId } = await pendingRequest();
    assert.deepEqual(
      notices.filter((notice) => notice.refId === appointmentId),
      [{ kind: "requested", refId: appointmentId }],
    );
  });

  it("lets the contractor approve it, once", async () => {
    const { service, notices, appointmentId } = await pendingRequest();
    const approved = await service.approve(ORG, appointmentId);
    assert.equal(approved.ok, true);
    assert.equal(approved.appointment.status, "confirmed");
    assert.equal(
      notices.some(
        (notice) => notice.kind === "confirmed" && notice.refId === appointmentId,
      ),
      true,
    );
    // A second click changes nothing and the short hold is never listed.
    const again = await service.approve(ORG, appointmentId);
    assert.equal(again.ok, true);
    const listed = await service.list(ORG);
    assert.deepEqual(
      listed.map((row) => [row.id, row.status]),
      [[appointmentId, "confirmed"]],
    );
  });

  it("refuses to approve a time that has passed or an appointment that is not pending", async () => {
    let now = NOW;
    const store = createMemorySchedulingStore();
    const service = createSchedulingService({
      store,
      now: () => now,
      calendar: async () => createSimulatedCalendar(),
    });
    await service.saveService({
      id: "svc_estimate",
      organizationId: ORG,
      name: "On-site estimate",
      durationMinutes: 60,
      bookingMode: "manual_approval",
      eligibleTechnicianIds: [],
      active: true,
    });
    const requested = await service.book({
      organizationId: ORG,
      serviceId: "svc_estimate",
      startAt: MONDAY_10,
      source: "dashboard",
    });
    now = new Date("2026-10-20T12:00:00.000Z");
    const late = await service.approve(ORG, requested.appointment!.id);
    assert.equal(late.ok, false);
    assert.equal("reason" in late ? late.reason : "", "past");
    await service.cancel(ORG, requested.appointment!.id, "customer changed plans");
    await assert.rejects(() => service.approve(ORG, requested.appointment!.id));
  });
});

describe("appointment actions (M3 and the low-severity list)", () => {
  it("shows one card after a reschedule", async () => {
    const { service } = scheduling();
    const booked = await service.book({
      organizationId: ORG,
      startAt: MONDAY_10,
      customerName: "Luc Gagnon",
      source: "dashboard",
    });
    const moved = await service.reschedule(ORG, booked.appointment!.id, MONDAY_13);
    assert.equal(moved.ok, true);
    const listed = await service.list(ORG);
    assert.deepEqual(
      listed.map((row) => [row.id, row.status, row.startAt]),
      [[booked.appointment!.id, "confirmed", MONDAY_13]],
    );
  });

  it("moves an appointment to a time that touches its current one", async () => {
    const { service } = scheduling();
    const booked = await service.book({
      organizationId: ORG,
      startAt: MONDAY_10,
      customerName: "Luc Gagnon",
      source: "dashboard",
    });
    // Half an hour later overlaps the appointment's own current time.
    const later = "2026-10-19T14:30:00.000Z";
    const moved = await service.reschedule(ORG, booked.appointment!.id, later);
    assert.equal(moved.ok, true);
    assert.deepEqual(
      (await service.list(ORG)).map((row) => [row.status, row.startAt]),
      [["confirmed", later]],
    );
    // Someone else's appointment still blocks a move.
    const other = await service.book({
      organizationId: ORG,
      startAt: MONDAY_13,
      customerName: "Anne Roy",
      source: "dashboard",
    });
    assert.equal(other.confirmed, true);
    const blocked = await service.reschedule(
      ORG,
      booked.appointment!.id,
      MONDAY_13,
    );
    assert.equal(blocked.ok, false);
  });

  it("does not mark a future appointment completed", async () => {
    const { service } = scheduling();
    const booked = await service.book({
      organizationId: ORG,
      startAt: MONDAY_10,
      source: "dashboard",
    });
    assert.equal(
      await codeOf(() =>
        service.updateDetails(ORG, booked.appointment!.id, { status: "completed" }),
      ),
      "not_started",
    );
  });

  it("keeps a simulated calendar failure out of the real schedule", async () => {
    const { service } = scheduling();
    const result = await service.book({
      organizationId: ORG,
      startAt: MONDAY_10,
      source: "simulation",
      simulated: true,
      simulateCalendarFailure: true,
    });
    assert.equal(result.confirmed, false);
    assert.equal(result.appointment?.simulated, true);
  });
});

describe("service types (M4 and duplicates)", () => {
  const base = {
    organizationId: ORG,
    durationMinutes: 60,
    bookingMode: "automatic" as const,
    eligibleTechnicianIds: [],
    active: true,
  };

  it("refuses a second service with the same name, but still switches one off", async () => {
    const { service } = scheduling();
    await service.saveService({ ...base, id: "svc_a", name: "Drain cleaning" });
    assert.equal(
      await codeOf(() =>
        service.saveService({ ...base, id: "svc_b", name: " drain CLEANING " }),
      ),
      "duplicate_name",
    );
    const off = await service.saveService({
      ...base,
      id: "svc_a",
      name: "Drain cleaning",
      active: false,
    });
    assert.equal(off.active, false);
  });

  it("says a switched-off service is inactive instead of unknown", async () => {
    const { service } = scheduling();
    await service.saveService({
      ...base,
      id: "svc_off",
      name: "Furnace tune-up",
      active: false,
    });
    assert.equal(
      await codeOf(() =>
        service.book({
          organizationId: ORG,
          serviceId: "svc_off",
          startAt: MONDAY_10,
          source: "dashboard",
        }),
      ),
      "service_inactive",
    );
  });
});

describe("phone numbers typed by a person (M5, M7, M12)", () => {
  it("accepts the usual ways of writing a number", () => {
    for (const typed of [
      "514-555-0123",
      "(514) 555 0123",
      "514.555.0123",
      "+1 514 555 0123",
      "15145550123",
    ]) {
      assert.equal(parsePhoneInput(typed), "+15145550123", typed);
    }
  });

  it("refuses what is not a phone number", () => {
    for (const typed of ["abc", "", "555-0123", "call me", "514-555-0123 ext 4"]) {
      assert.equal(parsePhoneInput(typed), null, typed);
    }
  });

  it("finds the number in a sentence that holds other numbers", () => {
    assert.equal(
      extractPhoneE164("I'm at 12 Main Street, my number is 514-555-0142"),
      "+15145550142",
    );
    assert.equal(extractPhoneE164("5 1 4 5 5 5 0 1 4 2"), "+15145550142");
    assert.equal(extractPhoneE164("I live at 12 Main Street"), null);
  });
});

describe("customer requests (low-severity list)", () => {
  it("finds an accented name with an unaccented search", async () => {
    assert.equal(searchFold("Côté"), "cote");
    const crm = createCrmService(createMemoryCrmStore());
    await crm.capture({
      organizationId: ORG,
      source: "manual",
      phoneE164: "+15145550123",
      displayName: "Hélène Côté",
    });
    const found = await crm.listLeads(ORG, { q: "cote" });
    assert.equal(found.length, 1);
    assert.equal((await crm.listLeads(ORG, { q: "tremblay" })).length, 0);
  });

  it("keeps the start of one very long description instead of nothing", () => {
    const long = `the water heater is leaking ${"and it keeps dripping on the floor ".repeat(200)}`;
    const cleaned = cleanProblemText(long, 600);
    assert.ok(cleaned.length > 0);
    assert.ok(cleaned.length <= 600);
    assert.ok(cleaned.endsWith("…"));
  });
});

describe("practice data (M8)", () => {
  it("keeps practice conversations out of the owner's call activity", () => {
    const call = (callSid: string) => ({ callSid }) as CallSession;
    assert.equal(isPracticeCall(call("sim_123")), true);
    assert.equal(isPracticeCall(call("demo_123")), true);
    assert.equal(isPracticeCall(call("CA1234567890")), false);
    assert.deepEqual(
      ownerVisibleCalls([call("sim_1"), call("CA1"), call("demo_2")]).map(
        (session) => session.callSid,
      ),
      ["CA1"],
    );
  });
});

describe("copy (double periods)", () => {
  it("ends a sentence once after a name or a time that ends in a period", () => {
    assert.equal(
      phrase("goodbye", "en", { business: "Nord Plumbing Inc." }),
      "Thank you for calling Nord Plumbing Inc. Goodbye!",
    );
    assert.equal(
      defaultGreetings("Nord Plumbing Inc.", "Lucie").greetingEn,
      "Hello, this is Lucie from Nord Plumbing Inc.",
    );
    assert.equal(
      tidySentence("Appointment confirmed for Nov 12, 9:00 a.m.."),
      "Appointment confirmed for Nov 12, 9:00 a.m.",
    );
    assert.equal(tidySentence("Saving..."), "Saving...");
  });
});

describe("account requests (duplicates and withdraw)", () => {
  it("returns the open request instead of adding a second one", async () => {
    const support = createSupportService({
      store: createMemorySupportStore(),
      now: () => NOW,
    });
    const first = await support.requestAccountChange(ORG, "deletion");
    const second = await support.requestAccountChange(ORG, "deletion");
    assert.equal(second.id, first.id);
    const other = await support.requestAccountChange(ORG, "suspension");
    assert.notEqual(other.id, first.id);
    assert.equal((await support.accountRequests(ORG)).length, 2);
  });

  it("lets the owner withdraw an open request and ask again later", async () => {
    const support = createSupportService({
      store: createMemorySupportStore(),
      now: () => NOW,
    });
    const first = await support.requestAccountChange(ORG, "deletion");
    const withdrawn = await support.withdrawAccountRequest(ORG, first.id);
    assert.equal(withdrawn.status, "withdrawn");
    assert.equal(
      (await support.accountRequests(ORG)).find((row) => row.id === first.id)
        ?.status,
      "withdrawn",
    );
    const again = await support.requestAccountChange(ORG, "deletion");
    assert.notEqual(again.id, first.id);
    assert.equal(again.status, "requested");
  });
});
