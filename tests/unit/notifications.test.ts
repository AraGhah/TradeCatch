import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNotificationService, type NoticeMember, type NoticeOrg } from "../../src/product/notifications/service";
import { createMemoryNotificationStore } from "../../src/product/notifications/store";

const NOW = new Date("2026-10-16T15:00:00.000Z");

function harness(options?: { now?: Date; org?: Partial<NoticeOrg>; failEmail?: boolean }) {
  const store = createMemoryNotificationStore();
  let now = options?.now ?? NOW;
  const calls = { email: 0, sms: 0 };
  const org: NoticeOrg = {
    id: "org-a",
    name: "Montreal Plumbing Pro",
    status: "active",
    timezone: "America/Toronto",
    localeDefault: "en",
    phoneE164: "+15145550111",
    accountType: "live",
    ...options?.org,
  };
  const members: NoticeMember[] = [
    { userId: "owner", role: "owner", email: "owner@example.com", locale: "en" },
    { userId: "tech", role: "member", email: "tech@example.com", locale: "fr" },
  ];
  const service = createNotificationService({
    store,
    now: () => now,
    listMembers: async (organizationId) => (organizationId === "org-a" ? members : [{ userId: "other", role: "owner", email: "b@example.com", locale: "en" }]),
    loadOrg: async (organizationId) => (organizationId === "org-b" ? { ...org, id: "org-b", name: "Other Co" } : organizationId === org.id ? org : null),
    sendEmail: async () => {
      calls.email += 1;
      if (options?.failEmail) return { sent: false, temporary: true, reason: "provider_down" };
      return { sent: true };
    },
    sendSms: async () => {
      calls.sms += 1;
      return { sent: true, sid: "SM123" };
    },
  });
  return { service, store, calls, members, setNow: (value: Date) => { now = value; } };
}

describe("contractor notifications", () => {
  it("creates an in-app lead notice from a backend event without emailing during simulation", async () => {
    const { service, calls } = harness();
    await service.enqueue({
      organizationId: "org-a",
      type: "lead_created",
      idempotencyKey: "lead-1",
      payload: { customer: "Test Customer A", service: "Water heater repair", location: "Laval", simulated: true },
    });
    await service.processDue();
    const rows = await service.listForUser("org-a", "owner");
    assert.equal(rows.length, 1);
    assert.match(rows[0].note.message, /Montreal Plumbing Pro/);
    assert.equal(rows[0].note.href, "/app/leads");
    assert.equal(calls.email, 0);
    assert.equal(calls.sms, 0);
    const again = await service.enqueue({ organizationId: "org-a", type: "lead_created", idempotencyKey: "lead-1" });
    await service.processDue();
    assert.equal(again.duplicate, true);
    assert.equal((await service.listForUser("org-a", "owner")).length, 1);
  });

  it("groups a later appointment into the same customer notification", async () => {
    const { service } = harness();
    await service.enqueue({
      organizationId: "org-a",
      type: "lead_created",
      idempotencyKey: "evt-1",
      payload: { customer: "John", service: "repair", consolidateKey: "call-1", simulated: true },
    });
    await service.enqueue({
      organizationId: "org-a",
      type: "appointment_confirmed",
      idempotencyKey: "evt-2",
      payload: { customer: "John", service: "repair", whenLabel: "tomorrow at 10 AM", consolidateKey: "call-1", simulated: true },
    });
    await service.processDue();
    const rows = await service.listForUser("org-a", "owner");
    assert.equal(rows.length, 1);
    assert.match(rows[0].note.message, /tomorrow at 10 AM/);
  });

  it("keeps urgent SMS simulated and separate from acknowledgement", async () => {
    const { service, calls } = harness();
    await service.saveEscalation({
      ...(await service.getEscalation("org-a")),
      secondaryUserId: "tech",
      delayMinutes: 15,
      acknowledgementRequired: true,
    });
    await service.enqueue({
      organizationId: "org-a",
      type: "urgent_request",
      idempotencyKey: "urgent-1",
      payload: { customer: "Customer", service: "basement flooding", location: "Laval", simulated: true },
    });
    await service.processDue();
    const [row] = await service.listForUser("org-a", "owner");
    assert.equal(row.note.priority, "critical");
    assert.equal(calls.sms, 0);
    const history = await service.history("org-a");
    assert.equal(history.some((item) => item.channel === "sms" && item.status === "simulated"), true);
    await service.acknowledge("org-a", "owner", row.note.id);
    const escalated = await service.processEscalations(new Date(NOW.getTime() + 60 * 60_000));
    assert.equal(escalated.escalated, 0);
  });

  it("notifies the backup when an urgent alert is not acknowledged", async () => {
    const { service } = harness();
    await service.saveEscalation({
      ...(await service.getEscalation("org-a")),
      secondaryUserId: "tech",
      delayMinutes: 15,
    });
    await service.enqueue({
      organizationId: "org-a",
      type: "urgent_request",
      idempotencyKey: "urgent-2",
      payload: { simulated: true, service: "flooding" },
    });
    await service.processDue();
    const escalated = await service.processEscalations(new Date(NOW.getTime() + 20 * 60_000));
    assert.equal(escalated.escalated, 1);
    const backup = await service.listForUser("org-a", "tech");
    assert.equal(backup.length, 1);
  });

  it("defers a normal alert outside quiet hours and still sends a critical one", async () => {
    const night = harness({ now: new Date("2026-10-16T02:00:00.000Z") });
    await night.service.enqueue({
      organizationId: "org-a",
      type: "lead_created",
      idempotencyKey: "night-lead",
      payload: { simulated: true, customer: "A" },
    });
    await night.service.processDue();
    const email = (await night.service.history("org-a")).find((row) => row.channel === "email");
    assert.equal(email?.status, "pending");
    assert.ok(email?.nextAttemptAt && email.nextAttemptAt > "2026-10-16T02:00:00.000Z");
    await night.service.enqueue({
      organizationId: "org-a",
      type: "urgent_request",
      idempotencyKey: "night-urgent",
      payload: { simulated: true, service: "flooding" },
    });
    await night.service.processDue();
    const urgentSms = (await night.service.history("org-a")).find((row) => row.channel === "sms");
    assert.equal(urgentSms?.status, "simulated");
  });

  it("records a dead delivery after repeated provider failures and does not include secrets", async () => {
    const { service, calls, setNow } = harness({ failEmail: true });
    await service.enqueue({
      organizationId: "org-a",
      type: "appointment_confirmed",
      idempotencyKey: "appt-1",
      payload: { live: true, simulated: false, customer: "John", whenLabel: "10:00", appointmentId: "appt_1" },
    });
    await service.processDue();
    setNow(new Date(NOW.getTime() + 2 * 60_000));
    await service.processDue();
    setNow(new Date(NOW.getTime() + 10 * 60_000));
    await service.processDue();
    setNow(new Date(NOW.getTime() + 30 * 60_000));
    await service.processDue();
    const email = (await service.history("org-a")).find((row) => row.channel === "email");
    assert.equal(email?.status, "dead");
    assert.equal(calls.email, 3);
    const alerts = await service.listAlerts();
    assert.equal(alerts.length > 0, true);
    assert.equal(JSON.stringify(alerts).includes("secret"), false);
    assert.equal(alerts[0].correlationId.length > 0, true);
  });

  it("follows updated preferences and isolates businesses", async () => {
    const { service } = harness();
    const prefs = await service.getPreferences("org-a", "owner", "fr");
    prefs.categories.new_leads.email = false;
    prefs.language = "fr";
    await service.savePreferences(prefs);
    await service.enqueue({
      organizationId: "org-a",
      type: "lead_created",
      idempotencyKey: "fr-lead",
      payload: { simulated: true, customer: "Alex", service: "drain" },
    });
    await service.processDue();
    const deliveries = await service.history("org-a");
    assert.equal(deliveries.some((row) => row.channel === "email"), false);
    assert.match((await service.listForUser("org-a", "owner"))[0].note.title, /prospect/i);
    await service.enqueue({ organizationId: "org-b", type: "lead_created", idempotencyKey: "other", payload: { simulated: true } });
    await service.processDue();
    assert.equal((await service.listForUser("org-a", "owner")).some((row) => row.note.organizationId === "org-b"), false);
    assert.equal((await service.listForUser("org-b", "owner")).length, 0);
    assert.equal((await service.listForUser("org-b", "other")).length, 1);
  });

  it("does not give an unassigned employee another person's lead", async () => {
    const { service } = harness();
    const prefs = await service.getPreferences("org-a", "tech", "fr");
    prefs.scope = "assigned";
    await service.savePreferences(prefs);
    await service.enqueue({
      organizationId: "org-a",
      type: "lead_created",
      idempotencyKey: "assigned",
      payload: { simulated: true, assigneeUserId: "owner" },
    });
    await service.processDue();
    assert.equal((await service.listForUser("org-a", "tech")).length, 0);
    assert.equal((await service.listForUser("org-a", "owner")).length, 1);
  });

  it("renders French and English without a phone number in the message", async () => {
    const { service } = harness();
    const fr = await service.getPreferences("org-a", "owner", "fr");
    fr.language = "fr";
    await service.savePreferences(fr);
    await service.enqueue({
      organizationId: "org-a",
      type: "urgent_request",
      idempotencyKey: "phone",
      payload: { simulated: true, customer: "+15145550199", location: "Laval", service: "flooding" },
    });
    await service.processDue();
    const message = (await service.listForUser("org-a", "owner"))[0].note.message;
    assert.equal(message.includes("514555"), false);
    assert.match(message, /Laval/);
  });
});
