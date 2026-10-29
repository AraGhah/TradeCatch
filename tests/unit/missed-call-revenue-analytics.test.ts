import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeAdvancedRevenueAnalytics } from "../../src/product/missed-call/revenue-analytics";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import type { LeadRecord, TechnicianAlertRecord } from "../../src/product/missed-call/types";

function alert(
  technicianId: string,
  response: TechnicianAlertRecord["response"],
): TechnicianAlertRecord {
  return {
    technicianId,
    phone: "+15145550000",
    sentAt: "2026-01-01T00:00:00.000Z",
    stage: "primary",
    actionToken: "AB12",
    response,
  };
}

function lead(overrides: Partial<LeadRecord> = {}): LeadRecord {
  return {
    id: "lead_1",
    clientAccountId: "client_demo",
    workflowId: "wf_1",
    callId: "call_1",
    callerE164: "+15145559999",
    photoUrls: [],
    serviceAreaFlagged: false,
    humanReviewRequired: false,
    conversation: [],
    techniciansAlerted: [],
    manualCorrections: [],
    outcome: "resolved",
    createdAt: "2026-01-15T12:00:00.000Z",
    updatedAt: "2026-01-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("computeAdvancedRevenueAnalytics", () => {
  it("attributes revenue to the technician who accepted the job", () => {
    const client = demoClientAccount();
    const leads = [
      lead({
        id: "lead_marc",
        becameBooking: true,
        finalValue: 400,
        techniciansAlerted: [alert("tech_marc", "accepted")],
      }),
      lead({
        id: "lead_sophie",
        becameBooking: true,
        finalValue: 250,
        techniciansAlerted: [
          alert("tech_marc", "declined"),
          alert("tech_sophie", "accepted"),
        ],
      }),
    ];

    const result = computeAdvancedRevenueAnalytics(client, leads);
    const marc = result.technicianRevenue.find((t) => t.technicianId === "tech_marc");
    const sophie = result.technicianRevenue.find((t) => t.technicianId === "tech_sophie");
    assert.equal(marc?.revenue, 400);
    assert.equal(marc?.jobsCompleted, 1);
    assert.equal(sophie?.revenue, 250);
    assert.equal(sophie?.jobsCompleted, 1);
    assert.equal(result.totalRevenue, 650);
  });

  it("falls back to estimatedValue when no finalValue is recorded", () => {
    const client = demoClientAccount();
    const leads = [lead({ estimatedValue: 150, becameBooking: true })];
    const result = computeAdvancedRevenueAnalytics(client, leads);
    assert.equal(result.totalRevenue, 150);
  });

  it("groups revenue by month", () => {
    const client = demoClientAccount();
    const leads = [
      lead({ id: "l1", createdAt: "2026-01-05T00:00:00.000Z", finalValue: 100 }),
      lead({ id: "l2", createdAt: "2026-01-20T00:00:00.000Z", finalValue: 200 }),
      lead({ id: "l3", createdAt: "2026-02-01T00:00:00.000Z", finalValue: 50 }),
    ];
    const result = computeAdvancedRevenueAnalytics(client, leads);
    assert.deepEqual(result.revenueByMonth, [
      { month: "2026-01", revenue: 300 },
      { month: "2026-02", revenue: 50 },
    ]);
  });

  it("computes lead-to-booking conversion and average revenue per booking", () => {
    const client = demoClientAccount();
    const leads = [
      lead({ id: "l1", becameBooking: true, finalValue: 300 }),
      lead({ id: "l2", becameBooking: true, finalValue: 100 }),
      lead({ id: "l3", becameBooking: false }),
    ];
    const result = computeAdvancedRevenueAnalytics(client, leads);
    assert.equal(result.totalLeads, 3);
    assert.equal(result.bookedLeads, 2);
    assert.equal(result.leadToRevenueConversionRate, 2 / 3);
    assert.equal(result.averageRevenuePerBooking, 200);
  });

  it("handles an empty lead list without dividing by zero", () => {
    const client = demoClientAccount();
    const result = computeAdvancedRevenueAnalytics(client, []);
    assert.equal(result.totalRevenue, 0);
    assert.equal(result.leadToRevenueConversionRate, 0);
    assert.equal(result.averageRevenuePerBooking, 0);
    assert.equal(result.revenueByMonth.length, 0);
  });

  it("ignores an unassignable technician id (not on the roster)", () => {
    const client = demoClientAccount();
    const leads = [
      lead({
        finalValue: 100,
        becameBooking: true,
        techniciansAlerted: [alert("tech_unknown", "accepted")],
      }),
    ];
    const result = computeAdvancedRevenueAnalytics(client, leads);
    assert.equal(result.totalRevenue, 100);
    assert.ok(
      result.technicianRevenue.every((t) => t.technicianId !== "tech_unknown"),
    );
  });
});
