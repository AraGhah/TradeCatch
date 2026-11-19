import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  ADMIN_PERMISSIONS,
  parseAdminEntries,
  parseAdminRole,
  permissionsOf,
  roleAllows,
} from "../../src/lib/admin-rbac";
import { adminRoleOf, isPlatformAdminUser } from "../../src/product/saas/platform-admin";
import { summarizeChanges, maskContact, sanitizeChanges } from "../../src/product/security/audit-changes";
import { createPostgresSecurityStore } from "../../src/product/security/runtime";
import { createMemorySecurityStore } from "../../src/product/security/store";
import {
  openAdminConsoleDb,
  pgliteAvailable,
  poolOf,
  readSchema,
  type Db,
} from "./support/pglite-db";

describe("admin roles (RBAC)", () => {
  it("treats a bare email as a super administrator and reads suffixes", () => {
    assert.deepEqual(
      parseAdminEntries("a@x.ca, b@x.ca:support, c@x.ca:read_only, ,d@x.ca:viewer"),
      [
        { email: "a@x.ca", role: "super_admin" },
        { email: "b@x.ca", role: "support" },
        { email: "c@x.ca", role: "read_only" },
        { email: "d@x.ca", role: "read_only" },
      ],
    );
  });

  it("fails closed: an unknown role suffix is the least privileged role", () => {
    assert.equal(parseAdminRole("superuser-ish"), "read_only");
    assert.equal(parseAdminRole("SUPPORT"), "support");
    assert.equal(parseAdminRole(undefined), "super_admin");
  });

  it("grants each role exactly its permissions", () => {
    assert.deepEqual([...permissionsOf("super_admin")], [...ADMIN_PERMISSIONS]);
    assert.equal(roleAllows("read_only", "admin.read"), true);
    for (const denied of ["audit.read", "business.write", "business.create", "billing.write", "website.write", "admin.manage"] as const) {
      assert.equal(roleAllows("read_only", denied), false, `read_only ${denied}`);
    }
    assert.equal(roleAllows("support", "business.write"), true);
    assert.equal(roleAllows("support", "website.write"), true);
    assert.equal(roleAllows("support", "billing.write"), false);
    assert.equal(roleAllows("support", "business.create"), false);
    assert.equal(roleAllows("support", "admin.manage"), false);
  });

  it("resolves a person's role from the operator list and the database flag", () => {
    const env = { TRADECATCH_ADMIN_EMAILS: "boss@x.ca, helper@x.ca:support, Viewer@X.ca:read_only" };
    assert.equal(adminRoleOf({ email: "boss@x.ca", platformRole: "none" }, env), "super_admin");
    assert.equal(adminRoleOf({ email: "HELPER@x.ca", platformRole: "none" }, env), "support");
    assert.equal(adminRoleOf({ email: "viewer@x.ca", platformRole: "none" }, env), "read_only");
    assert.equal(adminRoleOf({ email: "customer@shop.ca", platformRole: "none" }, env), null);
    // The database flag is a super administrator and wins over a weaker env entry.
    assert.equal(adminRoleOf({ email: "helper@x.ca", platformRole: "admin" }, env), "super_admin");
    // Existing identity checks keep working with suffixed entries.
    assert.equal(isPlatformAdminUser({ email: "helper@x.ca", platformRole: "none" }, env), true);
    assert.equal(isPlatformAdminUser({ email: "customer@shop.ca", platformRole: "none" }, env), false);
  });
});

describe("audit change summaries", () => {
  it("lists only what changed and masks contact details", () => {
    const changes = summarizeChanges(
      { name: "Nord Plumbing", phoneE164: "+15145550101", city: "Laval", ownerEmail: "jane@nord.ca" },
      { name: "Nord Plumbing Inc", phoneE164: "+15145550199", city: "Laval", ownerEmail: "jane@nord.ca" },
      ["name", "phoneE164", "city", "ownerEmail"],
    );
    assert.deepEqual(changes, [
      { field: "name", from: "Nord Plumbing", to: "Nord Plumbing Inc" },
      { field: "phoneE164", from: "***0101", to: "***0199" },
    ]);
    assert.equal(maskContact("jane@nord.ca"), "j***@nord.ca");
  });

  it("never records the value of a secret-like field", () => {
    const changes = summarizeChanges(
      { apiKey: "sk_live_abc", password: "hunter2" },
      { apiKey: "sk_live_def", password: "hunter3" },
      ["apiKey", "password"],
    );
    assert.deepEqual(changes, [{ field: "apiKey" }, { field: "password" }]);
    assert.doesNotMatch(JSON.stringify(changes), /sk_live|hunter/);
  });

  it("re-sanitizes whatever a caller hands the audit store", () => {
    const clean = sanitizeChanges([
      { field: "note", from: "call +15145550101 or a@b.ca", to: "Bearer abcdef123456" },
      { field: "cardNumber", from: "4242424242424242", to: "4000000000000002" },
      { nope: true },
    ]);
    assert.ok(clean);
    assert.doesNotMatch(JSON.stringify(clean), /4242|4000|abcdef|5145550101|a@b\.ca/);
    assert.deepEqual(clean[1], { field: "cardNumber" });
  });
});

describe("audit store search (memory)", () => {
  it("filters, searches and pages newest first", async () => {
    const store = createMemorySecurityStore();
    for (let i = 0; i < 7; i += 1) {
      await store.saveAudit({
        id: `aud_${i}`,
        action: i % 2 ? "admin_account_status" : "admin_request",
        actorUserId: i < 4 ? "usr_a" : "usr_b",
        actorEmail: i < 4 ? "a@x.ca" : "b@x.ca",
        organizationId: "org_1",
        target: `POST /api/admin/thing/${i}`,
        outcome: i === 6 ? "denied" : "success",
        createdAt: `2026-11-1${i}T10:00:00.000Z`,
      });
    }
    const page = await store.searchAudit({ limit: 3, offset: 0 });
    assert.equal(page.total, 7);
    assert.deepEqual(page.rows.map((r) => r.id), ["aud_6", "aud_5", "aud_4"]);
    assert.equal((await store.searchAudit({ outcome: "denied" })).total, 1);
    assert.equal((await store.searchAudit({ actorUserId: "usr_a" })).total, 4);
    assert.equal((await store.searchAudit({ q: "B@X.CA" })).total, 3);
    assert.equal((await store.searchAudit({ from: "2026-11-14", to: "2026-11-15" })).total, 2);
    assert.equal((await store.searchAudit({ limit: 1000 })).rows.length, 7);
  });
});

describe("audit log on real PostgreSQL (PGlite)", { skip: !pgliteAvailable }, () => {
  let db: Db;
  before(async () => {
    db = await openAdminConsoleDb();
  });
  after(async () => {
    await db?.close();
  });

  it("applies cleanly and can be applied again (idempotent migration)", async () => {
    await db.exec(readSchema("admin-console", "schema.sql"));
    const { rows } = await db.query(`SELECT id FROM mc_schema_migrations WHERE id = '041_admin_console'`);
    assert.equal(rows.length, 1);
  });

  it("stores who, what and outcome, and searches them", async () => {
    const store = createPostgresSecurityStore("postgres://unused", poolOf(db));
    await store.saveAudit({
      id: "aud_pg_1",
      organizationId: "org_9",
      actorUserId: "usr_1",
      actorEmail: "admin@tradecatch.ca",
      actorRole: "support",
      action: "admin_business_updated",
      target: "org_9",
      detail: "updated name",
      outcome: "success",
      changes: [{ field: "name", from: "Old", to: "New" }],
      createdAt: "2026-11-18T10:00:00.000Z",
    });
    await store.saveAudit({
      id: "aud_pg_2",
      actorUserId: "usr_2",
      actorEmail: "other@tradecatch.ca",
      action: "admin_permission_denied",
      target: "POST /api/admin/console/subscriptions",
      outcome: "denied",
      createdAt: "2026-11-18T11:00:00.000Z",
    });
    const all = await store.searchAudit({});
    assert.deepEqual(all.rows.map((r) => r.id), ["aud_pg_2", "aud_pg_1"]);
    const hit = (await store.searchAudit({ q: "ADMIN@tradecatch" })).rows;
    assert.equal(hit.length, 1);
    assert.equal(hit[0].actorRole, "support");
    assert.deepEqual(hit[0].changes, [{ field: "name", from: "Old", to: "New" }]);
    assert.equal((await store.searchAudit({ outcome: "denied" })).total, 1);
    assert.equal((await store.searchAudit({ organizationId: "org_9" })).total, 1);
    assert.equal((await store.searchAudit({ from: "2026-11-18", to: "2026-11-18" })).total, 2);
    assert.equal((await store.searchAudit({ from: "2026-11-19" })).total, 0);
    // LIKE wildcards in a search are literal, not patterns.
    assert.equal((await store.searchAudit({ q: "%" })).total, 0);
    assert.equal((await store.searchAudit({ q: "usr_" })).total, 0);
  });

  it("refuses to edit or delete a record (append-only)", async () => {
    await assert.rejects(
      db.query(`UPDATE tc_audit_logs SET action = 'tampered' WHERE id = 'aud_pg_1'`),
      /append-only/,
    );
    await assert.rejects(
      db.query(`DELETE FROM tc_audit_logs WHERE id = 'aud_pg_1'`),
      /append-only/,
    );
    const { rows } = await db.query(`SELECT action FROM tc_audit_logs WHERE id = 'aud_pg_1'`);
    assert.equal(rows[0].action, "admin_business_updated");
  });

  it("keeps writing audit rows on a database that has not run the migration yet", async () => {
    const legacy = await (async () => {
      const { openDb } = await import("./support/pglite-db");
      const old = await openDb();
      await old.exec(`CREATE TABLE tc_audit_logs (
        id TEXT PRIMARY KEY, organization_id TEXT, actor_user_id TEXT, action TEXT NOT NULL,
        target TEXT, detail TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());`);
      return old;
    })();
    try {
      const store = createPostgresSecurityStore("postgres://unused", poolOf(legacy));
      await store.saveAudit({
        id: "aud_legacy",
        actorUserId: "usr_1",
        actorEmail: "admin@tradecatch.ca",
        action: "admin_request",
        createdAt: "2026-11-18T10:00:00.000Z",
      });
      const { rows } = await legacy.query(`SELECT id, actor_user_id FROM tc_audit_logs`);
      assert.deepEqual(rows, [{ id: "aud_legacy", actor_user_id: "usr_1" }]);
    } finally {
      await legacy.close();
    }
  });
});
