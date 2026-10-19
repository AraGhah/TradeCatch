import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, it } from "node:test";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import {
  patchAiReceptionistSettings,
  putAppointmentSettings,
  putCallRouting,
  putKnowledge,
  putTransferSettings,
} from "../../src/product/receptionist/ai-receptionist-service";
import { createMemoryProfileStore } from "../../src/product/receptionist/profile-store";
import { forbiddenUnless } from "../../src/product/security/access";
import { allows, type SecurityAction } from "../../src/product/security/permissions";

const ROLES = ["owner", "admin", "member", "viewer"] as const;

describe("permission matrix", () => {
  const expected: Record<SecurityAction, readonly string[]> = {
    read: ["owner", "admin", "member", "viewer"],
    write_leads: ["owner", "admin", "member"],
    view_recordings: ["owner", "admin"],
    manage_ai: ["owner", "admin"],
    manage_billing: ["owner", "admin"],
    manage_security: ["owner", "admin"],
    manage_members: ["owner", "admin"],
    manage_settings: ["owner", "admin"],
  };

  for (const [action, roles] of Object.entries(expected)) {
    it(`${action}: ${roles.join(", ")}`, () => {
      for (const role of ROLES) {
        assert.equal(allows(role, action as SecurityAction), roles.includes(role), `${role} / ${action}`);
      }
    });
  }

  it("lets a platform administrator do anything", () => {
    for (const role of ROLES) assert.equal(allows(role, "manage_settings", true), true);
  });
});

describe("forbiddenUnless", () => {
  it("returns null when allowed and a 403 when not", async () => {
    assert.equal(forbiddenUnless("owner", "manage_settings"), null);
    assert.equal(forbiddenUnless("member", "write_leads"), null);
    for (const [role, action] of [
      ["viewer", "write_leads"],
      ["viewer", "manage_settings"],
      ["member", "manage_settings"],
    ] as const) {
      const res = forbiddenUnless(role, action);
      assert.ok(res, `${role} / ${action}`);
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { error: "Insufficient permissions." });
    }
    assert.equal(forbiddenUnless("viewer", "manage_settings", true), null);
  });
});

describe("receptionist settings are owner/admin only, whichever writer is used", () => {
  const base = { organizationId: "org_a", client: demoClientAccount(), userEmail: "someone@example.com" };

  for (const role of ["member", "viewer"] as const) {
    it(`refuses ${role} on every writer, with valid input`, async () => {
      const store = createMemoryProfileStore();
      const results = await Promise.all([
        patchAiReceptionistSettings(store, { ...base, role, body: { receptionistName: "Nope" } }),
        putKnowledge(store, { ...base, role, knowledge: {} }),
        putCallRouting(store, { ...base, role, callHandlingMode: "always" }),
        putTransferSettings(store, { ...base, role, transferSettings: {} }),
        putAppointmentSettings(store, { ...base, role, appointmentSettings: {} }),
      ]);
      results.forEach((result, index) => {
        assert.equal(result.ok, false, `writer #${index}`);
        if (!result.ok) assert.equal(result.status, 403, `writer #${index}`);
      });
      assert.equal(await store.getProfile("org_a"), null, "nothing was saved");
    });
  }
});

/**
 * Every route that changes data must make a role decision. These gates were
 * written by hand per route, which is how some were forgotten and others only
 * excluded `member`. A new mutating route now fails here until it either gates
 * on role or is added to the reviewed self-service list below.
 */
const API = join(__dirname, "..", "..", "src", "app", "api");

// Mutating routes any signed-in member (even a viewer) may call, with the reason.
const SELF_SERVICE: Record<string, string> = {
  "app/gmail/disconnect POST": "the caller's own mailbox",
  "app/gmail/messages/[id]/read POST": "the caller's own mailbox",
  "app/gmail/sync POST": "the caller's own mailbox, already throttled",
  "app/switch-organization POST": "platform-administrator elevation is checked inside",
  "businesses/[id]/notifications/[notificationId]/acknowledge POST": "the caller's own notifications",
  "businesses/[id]/notifications/[notificationId]/read PATCH": "the caller's own notifications",
  "businesses/[id]/notifications/read-all POST": "the caller's own notifications",
  "businesses/[id]/security/mfa POST": "administrator identity is checked inside",
  "businesses/[id]/security/sessions/[sessionId] POST": "revokes the caller's own session",
  "businesses/[id]/diagnostics POST": "read-only snapshot",
  "businesses/[id]/ai-receptionist/test POST": "simulation, rate limited",
  "businesses/[id]/calls/test POST": "simulation, rate limited",
  "businesses/[id]/leads/simulate POST": "demo businesses only",
  // Owner/admin is enforced in the service layer; covered by the writer tests above.
  "app/receptionist PUT": "profile-service: owner/admin",
  "businesses/[id]/ai-receptionist PATCH": "ai-receptionist-service: owner/admin",
  "businesses/[id]/ai-receptionist/activate POST": "profile-service: owner/admin",
  "businesses/[id]/ai-receptionist/deactivate POST": "profile-service: owner/admin",
  "businesses/[id]/appointment-settings PUT": "ai-receptionist-service: owner/admin",
  "businesses/[id]/call-routing PUT": "ai-receptionist-service: owner/admin",
  "businesses/[id]/knowledge PUT": "ai-receptionist-service: owner/admin",
  "businesses/[id]/transfer-settings PUT": "ai-receptionist-service: owner/admin",
  "businesses/[id]/notification-preferences PUT": "the caller's own preferences",
};

function routes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return routes(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

type Handler = { key: string; method: string; body: string; file: string };

function mutatingHandlers(): Handler[] {
  const files = [...routes(join(API, "businesses")), ...routes(join(API, "app"))];
  const out: Handler[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const parts = source.split(/(?=^export\s+(?:async\s+)?function\s+[A-Z]+\b)/m);
    const relative = file.slice(API.length + 1).split(sep).join("/").replace(/\/route\.ts$/, "");
    for (const part of parts) {
      const method = /^export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/.exec(part)?.[1];
      if (method) out.push({ key: `${relative} ${method}`, method, body: part, file: relative });
    }
  }
  return out;
}

const GATE = /forbiddenUnless\(|\ballows\(|assertPermission|canManageAccount|canCloseAccount|=== "viewer"|!== "viewer"/;

describe("every mutating route makes a role decision", () => {
  const handlers = mutatingHandlers();

  it("scans a realistic number of routes", () => {
    assert.ok(handlers.length >= 60, `found ${handlers.length} mutating handlers`);
  });

  it("gates each one on role, delegates to a gated helper, or is on the reviewed list", () => {
    const missing: string[] = [];
    for (const handler of handlers) {
      if (SELF_SERVICE[handler.key]) continue;
      const fileSource = readFileSync(join(API, handler.file, "route.ts"), "utf8");
      const delegated = /require(?:Scheduling|Automation|Notification)Access\(/.test(handler.body);
      if (delegated) {
        if (!/require(?:Scheduling|Automation|Notification)Access\([^)]*"write"/.test(handler.body)) {
          missing.push(`${handler.key} (calls an access helper without "write")`);
        }
        continue;
      }
      if (!GATE.test(handler.body) && !GATE.test(fileSource)) missing.push(handler.key);
    }
    assert.deepEqual(missing, [], "add a role gate (forbiddenUnless) or list the route as self-service with a reason");
  });

  it("has no stale entries on the reviewed list", () => {
    const known = new Set(handlers.map((h) => h.key));
    assert.deepEqual(Object.keys(SELF_SERVICE).filter((key) => !known.has(key)), []);
  });

  it("never decides a write by comparing against `member` alone", () => {
    const weak: string[] = [];
    for (const handler of handlers) {
      if (SELF_SERVICE[handler.key]) continue; // reviewed: e.g. a member's own notification scope, not an access gate
      if (/=== "member"|!== "member"/.test(handler.body) && !GATE.test(handler.body)) weak.push(handler.key);
    }
    assert.deepEqual(weak, []);
  });
});

describe("the shared access helpers enforce the permission model", () => {
  for (const file of ["scheduling", "sms-automation", "notifications"]) {
    it(`${file}/access.ts uses allows() and not a bare member check`, () => {
      const source = readFileSync(join(__dirname, "..", "..", "src", "product", file, "access.ts"), "utf8");
      assert.match(source, /allows\(tenant\.ctx\.membership\.role, "manage_settings", tenant\.ctx\.isPlatformAdmin\)/);
      assert.doesNotMatch(source, /=== "member"/);
    });
  }
});
