/**
 * POST /api/businesses/[id]/account/deletion-request: owner only, confirmed by
 * typing the business name, one open request at a time, audited, and nothing
 * deleted by the request itself.
 */
import "../support/next-request-context";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { withRequest } from "../support/next-request-context";
import { POST } from "../../src/app/api/businesses/[id]/account/deletion-request/route";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";
import type { SaasStore } from "../../src/product/saas/store";
import { signSessionClaims } from "../../src/product/saas/auth/session-token";
import { getSecurityService } from "../../src/product/security/runtime";
import { getSupportService } from "../../src/product/support/runtime";

const names = ["AUTH_SECRET", "NODE_ENV", "DATABASE_URL", "SAAS_DURABLE_STORE", "MISSED_CALL_DURABLE_STORE"];
const saved = new Map(names.map((name) => [name, process.env[name]]));
const runtime = globalThis as typeof globalThis & {
  __tradecatchSaas?: { store: SaasStore; durable: boolean };
};
let saas: SaasStore;

beforeEach(() => {
  names.forEach((name) => delete process.env[name]);
  process.env.AUTH_SECRET = "deletion-unit-secret-not-for-production";
  (process.env as { NODE_ENV?: string }).NODE_ENV = "development";
  saas = createMemorySaasStore();
  runtime.__tradecatchSaas = { store: saas, durable: false };
  mock.method(console, "warn", () => {});
  mock.method(console, "error", () => {});
});

afterEach(() => {
  mock.restoreAll();
  delete runtime.__tradecatchSaas;
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

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

async function business(name: string) {
  const f = await saas.createOrganizationWithOwner({
    name,
    ownerName: "Owner",
    ownerEmail: `${crypto.randomUUID()}@example.test`,
  });
  await saas.updateOrganizationPlan(f.organization.id, "growth");
  return f;
}

function post(orgId: string, cookie: string, body: unknown) {
  const request = new NextRequest(`https://tradecatch.test/api/businesses/${orgId}/account/deletion-request`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return withRequest(request, () => POST(request, { params: Promise.resolve({ id: orgId }) }));
}

describe("account deletion request", () => {
  it("needs the business name typed; a mismatch opens nothing and is audited", async () => {
    const f = await business("Plomberie Côté");
    const cookie = await signIn(f.organization.id, f.user.id);
    for (const body of [{ kind: "deletion" }, { confirm: "Plomberie" }, { confirm: "DELETE" }]) {
      const response = await post(f.organization.id, cookie, body);
      assert.equal(response?.status, 400, JSON.stringify(body));
    }
    assert.equal((await getSupportService().accountRequests(f.organization.id)).length, 0);
    const audit = await getSecurityService().listAudit(f.organization.id);
    assert.equal(audit.filter((row) => row.action === "account_deletion_confirmation_failed").length, 3);
    assert.equal(audit.filter((row) => row.action === "account_deletion_requested").length, 0);
  });

  it("an oversized body is a failed confirmation: nothing opens, and it is audited", async () => {
    const f = await business("Plomberie Côté");
    const cookie = await signIn(f.organization.id, f.user.id);
    // The right name, buried in a payload far larger than any confirmation.
    const response = await post(f.organization.id, cookie, {
      confirm: "Plomberie Côté",
      pad: "x".repeat(64 * 1024),
    });
    assert.equal(response?.status, 400);
    assert.equal((await getSupportService().accountRequests(f.organization.id)).length, 0);
    const audit = await getSecurityService().listAudit(f.organization.id);
    assert.equal(audit.filter((row) => row.action === "account_deletion_confirmation_failed").length, 1);
  });

  it("the owner typing the name opens one request for review, deletes nothing, and asking again returns it", async () => {
    const f = await business("Plomberie Côté");
    const cookie = await signIn(f.organization.id, f.user.id);
    const first = await post(f.organization.id, cookie, { kind: "deletion", confirm: "  plomberie  côté " });
    assert.equal(first?.status, 200);
    const body = (await first!.json()) as { request: { id: string; status: string }; deleted: boolean };
    assert.equal(body.deleted, false);
    assert.equal(body.request.status, "requested");
    const again = await post(f.organization.id, cookie, { kind: "deletion", confirm: "Plomberie Côté" });
    assert.equal(((await again!.json()) as { request: { id: string } }).request.id, body.request.id);
    assert.equal((await getSupportService().accountRequests(f.organization.id)).length, 1);
    const audit = await getSecurityService().listAudit(f.organization.id);
    assert.ok(audit.some((row) => row.action === "account_deletion_requested" && row.actorUserId === f.user.id));
    // The business and its owner are still there.
    assert.ok(await saas.getOrganization(f.organization.id));
    assert.ok(await saas.getUser(f.user.id));
  });

  it("an administrator, member or another business's owner cannot ask", async () => {
    const f = await business("Plomberie Côté");
    const other = await business("Autre");
    for (const role of ["admin", "member", "viewer"] as const) {
      const person = await business(`Home ${role}`);
      await saas.addMembership({ organizationId: f.organization.id, userId: person.user.id, role });
      const response = await post(f.organization.id, await signIn(f.organization.id, person.user.id), { confirm: "Plomberie Côté" });
      assert.equal(response?.status, 403, role);
    }
    const foreign = await post(f.organization.id, await signIn(other.organization.id, other.user.id), { confirm: "Plomberie Côté" });
    assert.equal(foreign?.status, 403);
  });
});
