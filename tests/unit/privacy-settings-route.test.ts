/**
 * GET/PATCH /api/businesses/[id]/privacy with real signed sessions against the
 * in-memory SaaS store. For every setting: enable → save → reload → enabled;
 * disable → save → sign in again → disabled; a failing store → an error and no
 * false success; a member, a viewer or another business → refused; business A
 * saving never changes business B; rapid saves keep the latest confirmed value.
 */
import "../support/next-request-context";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { withRequest } from "../support/next-request-context";
import { GET, PATCH } from "../../src/app/api/businesses/[id]/privacy/route";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";
import type { SaasStore } from "../../src/product/saas/store";
import { signSessionClaims } from "../../src/product/saas/auth/session-token";
import {
  selectPrivacyStoreKind,
  setPrivacyStoreForTests,
} from "../../src/product/privacy/runtime";
import {
  createMemoryPrivacyStore,
  type PrivacyAuditRow,
  type PrivacySettingsStore,
} from "../../src/product/privacy/store";

const names = ["AUTH_SECRET", "NODE_ENV", "DATABASE_URL", "SAAS_DURABLE_STORE", "MISSED_CALL_DURABLE_STORE"];
const saved = new Map(names.map((name) => [name, process.env[name]]));
const runtime = globalThis as typeof globalThis & {
  __tradecatchSaas?: { store: SaasStore; durable: boolean };
};
let saas: SaasStore;
let audits: PrivacyAuditRow[];
let privacy: PrivacySettingsStore;

beforeEach(() => {
  names.forEach((name) => delete process.env[name]);
  process.env.AUTH_SECRET = "privacy-unit-secret-not-for-production";
  (process.env as { NODE_ENV?: string }).NODE_ENV = "development";
  saas = createMemorySaasStore();
  runtime.__tradecatchSaas = { store: saas, durable: false };
  audits = [];
  privacy = createMemoryPrivacyStore((row) => {
    audits.push(row);
  });
  setPrivacyStoreForTests(privacy);
  mock.method(console, "warn", () => {});
  mock.method(console, "error", () => {});
});

afterEach(() => {
  mock.restoreAll();
  delete runtime.__tradecatchSaas;
  setPrivacyStoreForTests(undefined);
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

type Role = "owner" | "admin" | "member" | "viewer";

async function business(name = "Plomberie Test") {
  const f = await saas.createOrganizationWithOwner({
    name,
    ownerName: "Owner",
    ownerEmail: `${crypto.randomUUID()}@example.test`,
  });
  await saas.updateOrganizationPlan(f.organization.id, "growth");
  return f;
}

/** A fresh sign-in for this user: a new session and a new cookie. */
async function signIn(organizationId: string, userId: string) {
  const session = {
    id: crypto.randomUUID(),
    organizationId,
    userId,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    createdAt: new Date().toISOString(),
  };
  await saas.createSession(session);
  const token = await signSessionClaims(
    { sid: session.id, uid: userId, oid: organizationId, plan: "growth", exp: Math.floor(Date.now() / 1000) + 600 },
    process.env.AUTH_SECRET!,
  );
  return `tc_session=${token}`;
}

async function teammate(organizationId: string, role: Role) {
  // The store creates users with a business; this person then joins A in `role`.
  const other = await business(`Home of ${role}`);
  await saas.addMembership({ organizationId, userId: other.user.id, role });
  return signIn(organizationId, other.user.id);
}

function call(method: "GET" | "PATCH", orgId: string, cookie: string, body?: unknown) {
  const request = new NextRequest(`https://tradecatch.test/api/businesses/${orgId}/privacy`, {
    method,
    headers: { cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const ctx = { params: Promise.resolve({ id: orgId }) };
  return withRequest(request, () => (method === "GET" ? GET(request, ctx) : PATCH(request, ctx)));
}

async function load(orgId: string, cookie: string) {
  const response = await call("GET", orgId, cookie);
  assert.ok(response);
  assert.equal(response.status, 200);
  return ((await response.json()) as { settings: Record<string, unknown> & { version: number } }).settings;
}

async function save(orgId: string, cookie: string, body: Record<string, unknown>) {
  const response = await call("PATCH", orgId, cookie, body);
  assert.ok(response);
  return { status: response.status, body: (await response.json()) as { settings?: Record<string, unknown> & { version: number }; error?: string } };
}

const SETTINGS = [
  { field: "callRecordingEnabled", on: true, off: false },
  { field: "saveCallTranscripts", on: true, off: false },
  { field: "saveSmsHistory", on: true, off: false },
  { field: "customerDataRetentionDays", on: 180, off: 30 },
  { field: "analyticsEnabled", on: true, off: false },
] as const;

describe("privacy settings API", () => {
  it("loads the real stored values: defaults for a business that never saved", async () => {
    const f = await business();
    const cookie = await signIn(f.organization.id, f.user.id);
    const settings = await load(f.organization.id, cookie);
    assert.deepEqual(
      [settings.callRecordingEnabled, settings.saveCallTranscripts, settings.saveSmsHistory, settings.customerDataRetentionDays, settings.analyticsEnabled, settings.version],
      [false, true, true, 90, false, 0],
    );
  });

  for (const { field, on, off } of SETTINGS) {
    describe(field, () => {
      it("enable → save → reload: still enabled", async () => {
        const f = await business();
        const cookie = await signIn(f.organization.id, f.user.id);
        const before = await load(f.organization.id, cookie);
        const saved = await save(f.organization.id, cookie, { expectedVersion: before.version, [field]: on });
        assert.equal(saved.status, 200);
        assert.equal(saved.body.settings?.[field], on);
        assert.equal((await load(f.organization.id, cookie))[field], on);
        assert.equal(audits.length, 1);
        assert.equal(audits[0]!.actorUserId, f.user.id);
      });

      it("disable → save → sign in again: still disabled", async () => {
        const f = await business();
        const cookie = await signIn(f.organization.id, f.user.id);
        let version = (await load(f.organization.id, cookie)).version;
        version = (await save(f.organization.id, cookie, { expectedVersion: version, [field]: on })).body.settings!.version;
        const off_ = await save(f.organization.id, cookie, { expectedVersion: version, [field]: off });
        assert.equal(off_.status, 200);
        const relogin = await signIn(f.organization.id, f.user.id);
        assert.notEqual(relogin, cookie);
        assert.equal((await load(f.organization.id, relogin))[field], off);
      });

      it("a database failure returns an error, never a success, and the stored value is unchanged", async () => {
        const f = await business();
        const cookie = await signIn(f.organization.id, f.user.id);
        const before = await load(f.organization.id, cookie);
        const original = privacy.update.bind(privacy);
        privacy.update = async () => {
          throw new Error("connection reset");
        };
        const failed = await save(f.organization.id, cookie, { expectedVersion: before.version, [field]: on === before[field] ? off : on });
        assert.equal(failed.status, 503);
        assert.equal(failed.body.settings, undefined);
        assert.match(failed.body.error ?? "", /Unable to save/);
        privacy.update = original;
        assert.equal((await load(f.organization.id, cookie))[field], before[field]);
        assert.equal(audits.length, 0);
      });

      it("a member or viewer of the business, or another business's owner, is refused", async () => {
        const a = await business("A");
        const b = await business("B");
        const before = await load(a.organization.id, await signIn(a.organization.id, a.user.id));
        const member = await teammate(a.organization.id, "member");
        const viewer = await teammate(a.organization.id, "viewer");
        // They are signed in to A (they can read), so the refusal is their role.
        assert.deepEqual(await load(a.organization.id, member), before);
        assert.deepEqual(await load(a.organization.id, viewer), before);
        // An administrator may change them.
        const admin = await teammate(a.organization.id, "admin");
        assert.equal((await save(a.organization.id, admin, { expectedVersion: 0, [field]: on })).status, 200);
        const current = await load(a.organization.id, admin);
        audits.length = 0;
        for (const cookie of [member, viewer, await signIn(b.organization.id, b.user.id)]) {
          const denied = await save(a.organization.id, cookie, { expectedVersion: current.version, [field]: off });
          assert.equal(denied.status, 403);
        }
        // Another business cannot even read them.
        const peek = await call("GET", a.organization.id, await signIn(b.organization.id, b.user.id));
        assert.equal(peek?.status, 403);
        // Signed out.
        const anonymous = await call("PATCH", a.organization.id, "", { expectedVersion: current.version, [field]: off });
        assert.ok(anonymous && anonymous.status >= 401 && anonymous.status <= 403);
        assert.deepEqual(await load(a.organization.id, await signIn(a.organization.id, a.user.id)), current);
        assert.equal(audits.length, 0);
      });

      it("business A's change leaves business B unaffected", async () => {
        const a = await business("A");
        const b = await business("B");
        const aCookie = await signIn(a.organization.id, a.user.id);
        const bCookie = await signIn(b.organization.id, b.user.id);
        const bBefore = await load(b.organization.id, bCookie);
        assert.equal((await save(a.organization.id, aCookie, { expectedVersion: 0, [field]: on })).status, 200);
        assert.equal((await save(a.organization.id, aCookie, { expectedVersion: 1, [field]: off })).status, 200);
        assert.deepEqual(await load(b.organization.id, bCookie), bBefore);
      });

      it("rapid successive changes: the latest confirmed value persists, a stale one is refused", async () => {
        const f = await business();
        const cookie = await signIn(f.organization.id, f.user.id);
        let version = (await load(f.organization.id, cookie)).version;
        for (const value of [on, off, on, off, on]) {
          const r = await save(f.organization.id, cookie, { expectedVersion: version, [field]: value });
          assert.equal(r.status, 200);
          version = r.body.settings!.version;
        }
        // A second tab still holding version 0 cannot overwrite it.
        const stale = await save(f.organization.id, cookie, { expectedVersion: 0, [field]: off });
        assert.equal(stale.status, 409);
        assert.equal(stale.body.settings?.[field], on);
        // Two saves fired at once from the same version: one wins.
        const results = await Promise.all([
          save(f.organization.id, cookie, { expectedVersion: version, [field]: off }),
          save(f.organization.id, cookie, { expectedVersion: version, [field]: on }),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        const winner = results.find((r) => r.status === 200)!;
        assert.equal((await load(f.organization.id, cookie))[field], winner.body.settings![field]);
      });
    });
  }

  it("a save names only what it changes: other settings keep their stored value", async () => {
    const f = await business();
    const cookie = await signIn(f.organization.id, f.user.id);
    await save(f.organization.id, cookie, { expectedVersion: 0, callRecordingEnabled: true, customerDataRetentionDays: 180 });
    await save(f.organization.id, cookie, { expectedVersion: 1, analyticsEnabled: true });
    const settings = await load(f.organization.id, cookie);
    assert.deepEqual(
      [settings.callRecordingEnabled, settings.customerDataRetentionDays, settings.analyticsEnabled, settings.version],
      [true, 180, true, 2],
    );
  });

  it("rejects unknown fields, values outside the allowed set and empty saves", async () => {
    const f = await business();
    const cookie = await signIn(f.organization.id, f.user.id);
    for (const body of [
      { expectedVersion: 0, customerDataRetentionDays: 45 },
      { expectedVersion: 0, customerDataRetentionDays: null },
      { expectedVersion: 0, marketingEmailsEnabled: true },
      { expectedVersion: 0, organizationId: "org_other", analyticsEnabled: true },
      { expectedVersion: 0 },
      { analyticsEnabled: true },
    ]) {
      assert.equal((await save(f.organization.id, cookie, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await load(f.organization.id, cookie)).version, 0);
  });

  it("an unreadable store is an error, not defaults presented as the business's choice", async () => {
    const f = await business();
    const cookie = await signIn(f.organization.id, f.user.id);
    privacy.get = async () => {
      throw new Error("down");
    };
    const response = await call("GET", f.organization.id, cookie);
    assert.equal(response?.status, 503);
  });

  it("refuses an oversized or malformed body without storing anything", async () => {
    const f = await business();
    const cookie = await signIn(f.organization.id, f.user.id);
    const raw = (body: string) => {
      const request = new NextRequest(
        `https://tradecatch.test/api/businesses/${f.organization.id}/privacy`,
        { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body },
      );
      return withRequest(request, () =>
        PATCH(request, { params: Promise.resolve({ id: f.organization.id }) }),
      );
    };
    const big = await raw(JSON.stringify({ expectedVersion: 0, analyticsEnabled: true, pad: "x".repeat(8192) }));
    assert.equal(big?.status, 413);
    const bad = await raw("{not json");
    assert.equal(bad?.status, 400);
    assert.equal(audits.length, 0);
    const stored = await load(f.organization.id, cookie);
    assert.equal(stored.version, 0);
    assert.equal(stored.analyticsEnabled, false);
  });
});

describe("privacy store selection", () => {
  const select = (env: Record<string, string | undefined>) => selectPrivacyStoreKind(env);

  it("uses Postgres when a durable store is requested and a database is configured", () => {
    assert.equal(select({ MISSED_CALL_DURABLE_STORE: "1", DATABASE_URL: "postgres://x" }), "postgres");
    assert.equal(select({ SAAS_DURABLE_STORE: "1", DATABASE_URL: "postgres://x" }), "postgres");
  });

  it("never falls back to memory when durable is requested without a database", () => {
    assert.throws(() => select({ MISSED_CALL_DURABLE_STORE: "1" }), /requires DATABASE_URL/);
    assert.throws(() => select({ SAAS_DURABLE_STORE: "1", DATABASE_URL: "   " }), /requires DATABASE_URL/);
  });

  it("refuses memory in production when durability is required", () => {
    assert.throws(
      () => select({ NODE_ENV: "production", SAAS_REQUIRE_DURABLE: "1" }),
      /Refusing in-memory/,
    );
  });

  it("allows memory only for development and tests", () => {
    assert.equal(select({}), "memory");
    assert.equal(select({ NODE_ENV: "production" }), "memory");
    assert.equal(select({ DATABASE_URL: "postgres://x" }), "memory");
  });
});
