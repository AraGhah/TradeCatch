import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import {
  createNotificationService,
  type NoticeMember,
} from "../../src/product/notifications/service";
import { createMemoryNotificationStore } from "../../src/product/notifications/store";
import { createPostgresNotificationStore } from "../../src/product/notifications/postgres-store";
import { loadNotificationMembers } from "../../src/product/notifications/runtime";
import { createPostgresSaasStore } from "../../src/product/saas/postgres-store";
import { closePgPool } from "../../src/product/missed-call/postgres-store";

const now = new Date("2026-10-21T15:00:00Z");
function harness() {
  const store = createMemoryNotificationStore();
  const members: NoticeMember[] = [
    {
      userId: "owner",
      name: "Alice Owner",
      role: "owner",
      email: "alice@example.invalid",
      locale: "en",
      phoneE164: "+15145550101",
      phoneVerifiedAt: now.toISOString(),
    },
    {
      userId: "backup",
      name: "Benoît Backup",
      role: "member",
      email: "benoit@example.invalid",
      locale: "fr",
      phoneE164: "+15145550102",
      phoneVerifiedAt: now.toISOString(),
    },
    {
      userId: "unverified",
      name: "Claire Employee",
      role: "member",
      email: "claire@example.invalid",
      locale: "en",
      phoneE164: "+15145550103",
    },
  ];
  const texts: string[] = [];
  const service = createNotificationService({
    store,
    now: () => now,
    listMembers: async (id) => (id === "org" ? members : []),
    loadOrg: async (id) =>
      id === "org"
        ? {
            id,
            name: "Test",
            status: "active",
            timezone: "America/Toronto",
            localeDefault: "en",
            phoneE164: "+15145550999",
            accountType: "production",
          }
        : null,
    sendSms: async (input) => {
      texts.push(input.to);
      return { sent: true, sid: "SMtest" };
    },
    sendEmail: async () => ({ sent: true }),
  });
  return { store, members, texts, service };
}

describe("employee escalation contacts", () => {
  it("returns names/roles and only verified phone numbers, scoped to the organization", async () => {
    const h = harness(),
      contacts = await h.service.listEscalationContacts("org");
    assert.deepEqual(
      contacts.map((c) => [c.name, c.role, c.verifiedPhoneE164]),
      [
        ["Alice Owner", "owner", "+15145550101"],
        ["Benoît Backup", "member", "+15145550102"],
        ["Claire Employee", "member", undefined],
      ],
    );
    assert.deepEqual(await h.service.listEscalationContacts("another-org"), []);
    h.members[0].phoneVerifiedAt = "invalid";
    h.members[1].phoneVerifiedAt = "2099-01-01T00:00:00Z";
    assert.ok(
      (await h.service.listEscalationContacts("org")).every(
        (c) => !c.verifiedPhoneE164,
      ),
    );
  });
  it("persists selected employee IDs and derives the phone, ignoring a submitted phone", async () => {
    const h = harness();
    const rule = await h.service.saveEscalation({
      ...(await h.service.getEscalation("org")),
      primaryUserId: "owner",
      secondaryUserId: "backup",
      secondaryPhoneE164: "+15145550999",
    });
    assert.equal(rule.secondaryPhoneE164, "+15145550102");
    assert.equal(
      (await h.service.getEscalation("org")).secondaryUserId,
      "backup",
    );
    const cleared = await h.service.saveEscalation({
      ...rule,
      secondaryUserId: undefined,
    });
    assert.equal(cleared.secondaryPhoneE164, undefined);
  });
  it("rejects unknown, cross-organization, removed and duplicate contacts without overwriting settings", async () => {
    const h = harness(),
      rule = await h.service.saveEscalation({
        ...(await h.service.getEscalation("org")),
        primaryUserId: "owner",
        secondaryUserId: "backup",
      });
    for (const patch of [
      { primaryUserId: "outsider" },
      { secondaryUserId: "unknown" },
      { secondaryUserId: "owner" },
    ])
      await assert.rejects(() =>
        h.service.saveEscalation({ ...rule, ...patch }),
      );
    h.members.splice(1, 1);
    await assert.rejects(() => h.service.saveEscalation({ ...rule }));
    assert.equal(
      (await h.service.getEscalation("org")).secondaryUserId,
      "backup",
    );
  });
  it("allows email fallback for unverified contacts, but rejects SMS-only configuration", async () => {
    const h = harness(),
      rule = {
        ...(await h.service.getEscalation("org")),
        secondaryUserId: "unverified",
      };
    assert.equal(
      (await h.service.saveEscalation({ ...rule })).secondaryPhoneE164,
      undefined,
    );
    await assert.rejects(
      () => h.service.saveEscalation({ ...rule, emailEnabled: false }),
      /verified phone/,
    );
  });
  it("queues the backup's verified personal number and cancels delivery if verification is revoked", async () => {
    const h = harness();
    await h.service.saveEscalation({
      ...(await h.service.getEscalation("org")),
      primaryUserId: "owner",
      secondaryUserId: "backup",
      delayMinutes: 1,
    });
    await h.service.enqueue({
      organizationId: "org",
      type: "urgent_request",
      idempotencyKey: "urgent",
      payload: { live: true, simulated: false },
    });
    await h.service.processDue();
    assert.deepEqual(h.texts, ["+15145550101"]);
    await h.service.processEscalations(new Date(now.getTime() + 120000));
    const queued = (await h.service.history("org")).find((d) =>
      d.idempotencyKey.includes(":escalation:"),
    );
    assert.equal(queued?.destination, "+15145550102");
    h.members[1].phoneVerifiedAt = undefined;
    await h.service.processDue();
    assert.deepEqual(h.texts, ["+15145550101"]);
    assert.equal(
      (await h.service.history("org")).find((d) => d.id === queued?.id)?.status,
      "canceled",
    );
  });
  it("uses email for an unverified backup instead of the business phone", async () => {
    const h = harness();
    await h.service.saveEscalation({
      ...(await h.service.getEscalation("org")),
      primaryUserId: "owner",
      secondaryUserId: "unverified",
      delayMinutes: 1,
    });
    await h.service.enqueue({
      organizationId: "org",
      type: "urgent_request",
      idempotencyKey: "fallback",
    });
    await h.service.processDue();
    await h.service.processEscalations(new Date(now.getTime() + 120000));
    const delivery = (await h.service.history("org")).find((d) =>
      d.idempotencyKey.includes(":escalation:"),
    );
    assert.equal(delivery?.channel, "email");
    assert.equal(delivery?.destination, "claire@example.invalid");
  });
});

describe(
  "employee contacts on isolated PostgreSQL",
  { skip: !process.env.NOTIFICATION_TEST_DATABASE_URL },
  () => {
    let admin: Pool, db: Pool, url: string;
    const schema = "contacts_" + randomUUID().replaceAll("-", "");
    before(async () => {
      const base = new URL(process.env.NOTIFICATION_TEST_DATABASE_URL!);
      assert.equal(base.hostname, "127.0.0.1");
      assert.equal(base.pathname, "/tc003_staging");
      assert.equal(base.search, "");
      admin = new Pool({ connectionString: base.href });
      await admin.query(`CREATE SCHEMA ${schema}`);
      base.searchParams.set("options", "-c search_path=" + schema);
      url = base.href;
      db = new Pool({ connectionString: url });
      for (const file of [
        "missed-call/schema.sql",
        "saas/schema.sql",
        "saas/schema-demo-businesses.sql",
        "saas/notification-contacts.sql",
        "saas/notification-contacts.sql",
        "notifications/schema.sql",
        "notifications/delivery-reliability.sql",
      ])
        await db.query(readFileSync("src/product/" + file, "utf8"));
    });
    after(async () => {
      await closePgPool();
      await db?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.end();
      }
    });
    it("loads actual membership names/verified phones and round-trips selected IDs", async () => {
      const saas = createPostgresSaasStore(url);
      const alice = await saas.createOrganizationWithOwner({
        name: "Contacts staging",
        ownerName: "Alice Staging",
        ownerEmail: "alice@example.invalid",
        accountType: "demo",
      });
      const bob = await saas.createOrganizationWithOwner({
        name: "Other staging",
        ownerName: "Bob Staging",
        ownerEmail: "bob@example.invalid",
        accountType: "demo",
      });
      await db.query(
        "INSERT INTO tc_memberships(id,organization_id,user_id,role) VALUES('backup_membership',$1,$2,'member')",
        [alice.organization.id, bob.user.id],
      );
      await db.query(
        "UPDATE tc_users SET notification_phone_e164='+15145550102',notification_phone_verified_at=$2 WHERE id=$1",
        [bob.user.id, now.toISOString()],
      );
      await assert.rejects(() =>
        db.query(
          "UPDATE tc_users SET notification_phone_e164='+15145550101' WHERE id=$1",
          [alice.user.id],
        ),
      );
      const service = createNotificationService({
        store: createPostgresNotificationStore(url),
        now: () => now,
        listMembers: (id) => loadNotificationMembers(id, saas),
        loadOrg: async () => null,
      });
      const contacts = await service.listEscalationContacts(
        alice.organization.id,
      );
      assert.equal(contacts.length, 2);
      assert.equal(
        contacts.find((c) => c.userId === bob.user.id)?.verifiedPhoneE164,
        "+15145550102",
      );
      assert.equal(
        contacts.find((c) => c.userId === alice.user.id)?.verifiedPhoneE164,
        undefined,
      );
      await service.saveEscalation({
        ...(await service.getEscalation(alice.organization.id)),
        primaryUserId: alice.user.id,
        secondaryUserId: bob.user.id,
        secondaryPhoneE164: "+15145550999",
      });
      const saved = await service.getEscalation(alice.organization.id);
      assert.equal(saved.secondaryUserId, bob.user.id);
      assert.equal(saved.secondaryPhoneE164, "+15145550102");
      const otherRule = await service.getEscalation(bob.organization.id);
      await assert.rejects(() =>
        service.saveEscalation({ ...otherRule, primaryUserId: alice.user.id }),
      );
    });
  },
);
