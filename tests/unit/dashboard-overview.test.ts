import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDashboardOverview,
  percentChange,
  resolveDashboardRange,
  type DashboardAppointmentInput,
  type DashboardCallInput,
  type DashboardOverview,
  type DashboardRecoveryInput,
} from "../../src/product/saas/dashboard-overview";

const NOW = new Date("2026-10-18T15:00:00.000Z");
const ZONE = "America/Toronto";

const sources: DashboardOverview["sources"] = {
  calls: "ready",
  leads: "ready",
  recovery: "ready",
  appointments: "ready",
  revenue: "ready",
  notices: "ready",
  pipeline: "ready",
  reviews: "ready",
};

function call(partial: Partial<DashboardCallInput> & Pick<DashboardCallInput, "id" | "startedAt">): DashboardCallInput {
  return {
    fromE164: "+15145550100",
    status: "completed",
    transfersCompleted: 0,
    turns: [],
    ...partial,
  };
}

function recovery(
  partial: Partial<DashboardRecoveryInput> & Pick<DashboardRecoveryInput, "id" | "createdAt">,
): DashboardRecoveryInput {
  return {
    name: "Client",
    outcome: "open",
    replied: false,
    humanReview: false,
    ...partial,
  };
}

function appointment(
  partial: Partial<DashboardAppointmentInput> & Pick<DashboardAppointmentInput, "id">,
): DashboardAppointmentInput {
  return {
    serviceName: "Drain",
    startAt: "2026-10-20T15:00:00.000Z",
    status: "confirmed",
    bookingSource: "dashboard",
    createdAt: "2026-10-18T14:00:00.000Z",
    updatedAt: "2026-10-18T14:00:00.000Z",
    ...partial,
  };
}

function build(
  partial: Partial<Parameters<typeof buildDashboardOverview>[0]> = {},
  preset: "today" | "7d" | "30d" = "today",
) {
  return buildDashboardOverview({
    now: NOW,
    range: resolveDashboardRange({ range: preset, now: NOW, timeZone: ZONE }),
    calls: [],
    leads: [],
    recovery: [],
    appointments: [],
    revenue: [],
    notices: [],
    pipeline: [],
    reviews: [],
    sources,
    truncated: { calls: false, leads: false },
    ...partial,
  });
}

describe("dashboard range", () => {
  it("compares today with the same elapsed time yesterday", () => {
    const range = resolveDashboardRange({ range: "today", now: NOW, timeZone: ZONE });
    assert.equal(range.preset, "today");
    assert.equal(range.from, "2026-10-18T04:00:00.000Z");
    assert.equal(range.to, NOW.toISOString());
    assert.equal(range.previousFrom, "2026-10-17T04:00:00.000Z");
    assert.equal(range.previousTo, "2026-10-17T15:00:00.000Z");
  });

  it("falls back to 7 days when a custom range is not a real date", () => {
    const range = resolveDashboardRange({
      range: "custom",
      from: "2026-02-31",
      to: "nope",
      now: NOW,
      timeZone: ZONE,
    });
    assert.equal(range.preset, "7d");
  });

  it("does not invent a percentage when the previous window is empty", () => {
    assert.equal(percentChange(3, 0), null);
    assert.equal(percentChange(0, 0), 0);
    assert.equal(percentChange(15, 10), 50);
  });
});

describe("dashboard overview", () => {
  it("partitions calls and leaves averages empty when duration is missing", () => {
    const overview = build({
      calls: [
        call({
          id: "answered",
          startedAt: "2026-10-18T12:00:00.000Z",
          outcome: "faq_answered",
          turns: [{ speaker: "agent", text: "Oui" }],
          durationSeconds: 40,
        }),
        call({
          id: "missed",
          startedAt: "2026-10-18T13:00:00.000Z",
          outcome: "voicemail",
        }),
        call({
          id: "open",
          startedAt: "2026-10-18T14:00:00.000Z",
          status: "in_progress",
        }),
        call({
          id: "yesterday",
          startedAt: "2026-10-17T12:00:00.000Z",
          outcome: "failed",
          durationSeconds: 10,
        }),
        call({
          id: "old",
          startedAt: "2026-09-01T12:00:00.000Z",
          outcome: "transferred",
          transfersCompleted: 1,
        }),
      ],
    });

    assert.ok(overview.calls);
    assert.equal(overview.calls.incoming.current, 3);
    assert.equal(overview.calls.answered.current, 1);
    assert.equal(overview.calls.missed.current, 1);
    assert.equal(overview.calls.open.current, 1);
    assert.equal(overview.calls.aiHandled.current, 1);
    assert.equal(overview.calls.followUp.current, 1);
    assert.equal(overview.calls.incoming.previous, 1);
    assert.equal(overview.calls.avgDurationSeconds.current, 40);
    assert.equal(overview.calls.avgDurationSeconds.samples, 1);
    assert.equal(overview.calls.transferred.current, 0);
    assert.equal(overview.callRows.some((row) => row.id === "old"), false);
  });

  it("does not invent revenue and only sums amounts that exist", () => {
    const overview = build({
      recovery: [
        recovery({ id: "a", createdAt: "2026-10-18T12:00:00.000Z", estimatedValue: 0 }),
        recovery({
          id: "b",
          createdAt: "2026-10-18T13:00:00.000Z",
          finalValue: 800,
          outcome: "technician_accepted",
          jobAccepted: true,
          technicianResponseMs: 120_000,
          replied: true,
        }),
      ],
      revenue: [{ amount: 0, occurredAt: "2026-10-18T13:00:00.000Z" }],
      pipeline: [{ stage: "lost", estimatedValue: 5000 }, { stage: "quoted", estimatedValue: 200 }],
    });
    assert.equal(overview.recovery?.estimatedValue.current, 800);
    assert.equal(overview.recovery?.estimatedValue.samples, 1);
    assert.equal(overview.recovery?.recovered.current, 1);
    assert.equal(overview.recovery?.avgResponseMs.current, 120_000);
    assert.equal(overview.recordedRevenue?.current, null);
    assert.equal(overview.pipelineEstimate, 200);
  });

  it("keeps hold appointments out of booked counts and reports AI bookings", () => {
    const overview = build({
      appointments: [
        appointment({ id: "hold", status: "hold" }),
        appointment({
          id: "ai",
          bookingSource: "ai_receptionist",
          status: "confirmed",
          customerName: "Sam",
        }),
        appointment({
          id: "done",
          status: "completed",
          createdAt: "2026-10-10T12:00:00.000Z",
          updatedAt: "2026-10-18T12:00:00.000Z",
        }),
        appointment({
          id: "cancel",
          status: "canceled",
          updatedAt: "2026-10-18T13:00:00.000Z",
        }),
      ],
    });
    assert.equal(overview.appointments?.booked.current, 2);
    assert.equal(overview.appointments?.aiBooked.current, 1);
    assert.equal(overview.appointments?.completed.current, 1);
    assert.equal(overview.appointments?.canceled.current, 1);
    assert.equal(overview.appointments?.upcoming, 1);
  });

  it("drops unsafe recording links and keeps an authorized transcript", () => {
    const overview = build({
      calls: [
        call({
          id: "safe",
          startedAt: "2026-10-18T12:00:00.000Z",
          outcome: "faq_answered",
          recordingUrl: "javascript:alert(1)",
          turns: [
            { speaker: "caller", text: "Êtes-vous ouverts?" },
            { speaker: "agent", text: "Oui, jusqu'à 17 h." },
          ],
        }),
      ],
    });
    assert.equal(overview.aiCalls[0]?.recordingUrl, undefined);
    assert.equal(overview.aiCalls[0]?.turns.length, 2);
    assert.equal(overview.aiCalls[0]?.turns[0]?.speaker, "caller");
  });

  it("returns null metric blocks when a source failed instead of zeros", () => {
    const overview = build({
      calls: null,
      recovery: null,
      revenue: null,
      sources: { ...sources, calls: "error", recovery: "unlinked", revenue: "plan" },
    });
    assert.equal(overview.calls, null);
    assert.equal(overview.recovery, null);
    assert.equal(overview.recordedRevenue, null);
  });
});
