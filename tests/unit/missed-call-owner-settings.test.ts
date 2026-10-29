import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { saveSmsReceptionistSettings } from "../../src/product/missed-call/owner-settings";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import type { ClientAccount } from "../../src/product/missed-call/types";

function baseClient(): ClientAccount {
  const client = structuredClone(demoClientAccount());
  client.id = "client_pilot";
  client.smsFromNumber = "+14162220001";
  client.humanReviewPhone = "+14162220009";
  client.technicianRoster = [
    { id: "tech_a", name: "Alex", phone: "+14162220002", role: "primary", active: true },
    { id: "tech_b", name: "Bea", phone: "+14162220003", role: "backup", active: true },
  ];
  client.onCallTechnicians = client.technicianRoster.map((t) => ({
    id: t.id,
    name: t.name,
    phone: t.phone,
    active: t.active,
  }));
  client.mainTechnicianId = "tech_a";
  client.backupTechnicianIds = ["tech_b"];
  client.ownerTechnicianId = undefined;
  client.onCallSchedule = [
    { day: 1, start: "08:00", end: "17:00", technicianId: "tech_a" },
  ];
  return client;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    contractorDisplayName: "Bea's Plumbing",
    timezone: "America/Toronto",
    businessHours: { start: "08:00", end: "17:00", days: [1, 2, 3, 4, 5] },
    technicianRoster: [
      { id: "tech_a", name: "Alex", phone: "+14162220002", role: "primary", active: true },
      { id: "tech_b", name: "Bea", phone: "+14162220003", role: "backup", active: true },
    ],
    humanReviewPhone: "+14162220009",
    ...overrides,
  };
}

function depsFor(client: ClientAccount | null) {
  const saved: ClientAccount[] = [];
  return {
    deps: {
      getClient: async (id: string) =>
        client && client.id === id ? client : null,
      saveClient: async (c: ClientAccount) => {
        saved.push(c);
      },
    },
    saved,
  };
}

describe("saveSmsReceptionistSettings", () => {
  it("refuses members and viewers", async () => {
    const { deps } = depsFor(baseClient());
    for (const role of ["member", "viewer"] as const) {
      const result = await saveSmsReceptionistSettings(deps, {
        organization: { id: "org_1", missedCallClientId: "client_pilot" },
        role,
        body: validBody(),
      });
      assert.equal(result.status, 403);
    }
  });

  it("rejects a malformed body with field-level issues", async () => {
    const { deps } = depsFor(baseClient());
    const result = await saveSmsReceptionistSettings(deps, {
      organization: { id: "org_1", missedCallClientId: "client_pilot" },
      role: "owner",
      body: validBody({ timezone: "" }),
    });
    assert.equal(result.status, 400);
    assert.ok(Array.isArray(result.body.issues));
  });

  it("returns 409 when the organization has no linked client yet", async () => {
    const { deps } = depsFor(null);
    const result = await saveSmsReceptionistSettings(deps, {
      organization: { id: "org_1", missedCallClientId: null },
      role: "owner",
      body: validBody(),
    });
    assert.equal(result.status, 409);
  });

  it("returns 409 when missedCallClientId points at a client that no longer exists", async () => {
    const { deps } = depsFor(null);
    const result = await saveSmsReceptionistSettings(deps, {
      organization: { id: "org_1", missedCallClientId: "client_gone" },
      role: "owner",
      body: validBody(),
    });
    assert.equal(result.status, 409);
  });

  it("saves business details and roster, keeping the existing smsFromNumber (not part of the editable schema)", async () => {
    const client = baseClient();
    const { deps, saved } = depsFor(client);
    const result = await saveSmsReceptionistSettings(deps, {
      organization: { id: "org_1", missedCallClientId: "client_pilot" },
      role: "admin",
      body: validBody({ contractorDisplayName: "Renamed Co" }),
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.contractorDisplayName, "Renamed Co");
    assert.equal(saved.length, 1);
    assert.equal(saved[0]!.smsFromNumber, "+14162220001");
    assert.equal(saved[0]!.contractorDisplayName, "Renamed Co");
  });

  it("rejects a body carrying a caller-supplied smsFromNumber instead of silently dropping it", async () => {
    const { deps } = depsFor(baseClient());
    const result = await saveSmsReceptionistSettings(deps, {
      organization: { id: "org_1", missedCallClientId: "client_pilot" },
      role: "admin",
      body: {
        ...validBody(),
        smsFromNumber: "+15555555555",
      },
    });
    assert.equal(result.status, 400);
  });

  it("assigns a fresh id to a new technician and keeps existing ids stable", async () => {
    const client = baseClient();
    const { deps, saved } = depsFor(client);
    const result = await saveSmsReceptionistSettings(deps, {
      organization: { id: "org_1", missedCallClientId: "client_pilot" },
      role: "owner",
      body: validBody({
        technicianRoster: [
          { id: "tech_a", name: "Alex", phone: "+14162220002", role: "primary", active: true },
          { name: "New Hire", phone: "+14162220004", role: "backup", active: true },
        ],
      }),
    });
    assert.equal(result.status, 200);
    const roster = saved[0]!.technicianRoster;
    assert.equal(roster.length, 2);
    assert.equal(roster[0]!.id, "tech_a");
    assert.notEqual(roster[1]!.id, "");
    assert.notEqual(roster[1]!.id, "tech_a");
  });

  it("requires at least one primary technician", async () => {
    const { deps } = depsFor(baseClient());
    const result = await saveSmsReceptionistSettings(deps, {
      organization: { id: "org_1", missedCallClientId: "client_pilot" },
      role: "owner",
      body: validBody({
        technicianRoster: [
          { id: "tech_b", name: "Bea", phone: "+14162220003", role: "backup", active: true },
        ],
      }),
    });
    assert.equal(result.status, 400);
  });

  it("rejects a reserved demo phone number via the same production validation as the legacy path", async () => {
    const { deps } = depsFor(baseClient());
    const result = await saveSmsReceptionistSettings(deps, {
      organization: { id: "org_1", missedCallClientId: "client_pilot" },
      role: "owner",
      body: validBody({
        technicianRoster: [
          { id: "tech_a", name: "Alex", phone: "+15145550199", role: "primary", active: true },
        ],
      }),
    });
    assert.equal(result.status, 400);
    assert.ok(
      (result.body.issues as string[]).some((e) =>
        e.includes("reserved demo phone"),
      ),
    );
  });

  it("re-points an on-call schedule slot whose technician was removed, instead of leaving it dangling", async () => {
    const client = baseClient();
    const { deps, saved } = depsFor(client);
    const result = await saveSmsReceptionistSettings(deps, {
      organization: { id: "org_1", missedCallClientId: "client_pilot" },
      role: "owner",
      body: validBody({
        technicianRoster: [
          { id: "tech_a", name: "Alex", phone: "+14162220002", role: "primary", active: true },
        ],
      }),
    });
    assert.equal(result.status, 200);
    assert.deepEqual(
      saved[0]!.onCallSchedule.map((s) => s.technicianId),
      ["tech_a"],
    );
  });
});
