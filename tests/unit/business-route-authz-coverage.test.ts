import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..", "..");
const BUSINESS_ROUTES_DIR = join(
  ROOT,
  "src",
  "app",
  "api",
  "businesses",
  "[id]",
);

/**
 * Every known helper that independently verifies, server-side, that the
 * caller is authorized for the organization in the URL (session tenant
 * match, platform-admin bearer, or a feature-specific wrapper that itself
 * calls one of these). See src/app/api/businesses/[id]/_shared.ts,
 * src/product/saas/tenant.ts, src/product/security/access.ts, and the
 * per-feature access.ts modules.
 */
const KNOWN_AUTHZ_HELPERS = [
  "requireTenantContext",
  "requireBillingContext",
  "requireSameBusiness",
  "requireNotificationAccess",
  "requireSchedulingAccess",
  "requireAutomationAccess",
  "authorizeBusinessMemberOrAdmin",
  "authorizeBusinessAccess",
  "authorizeAdminRequest",
];

const AUTHZ_PATTERN = new RegExp(
  `\\b(${KNOWN_AUTHZ_HELPERS.join("|")})\\b`,
);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

/**
 * Regression guard for the tenant-isolation audit's informational finding:
 * authorization here is 100% per-route application code (no RLS backstop),
 * so a new route under /api/businesses/[id]/** that forgets to call one of
 * the known authz helpers would be a silent cross-tenant IDOR with nothing
 * to catch it. This test is that backstop — it fails loudly the moment a
 * route is added or edited to drop the check, without requiring a manual
 * security re-audit of every future change in this tree.
 */
describe("every /api/businesses/[id] route enforces authorization", () => {
  const files = routeFiles(BUSINESS_ROUTES_DIR);

  it("found route files to check (the scan itself didn't silently match nothing)", () => {
    assert.ok(
      files.length >= 60,
      `expected a few dozen route.ts files under businesses/[id], found ${files.length}`,
    );
  });

  for (const file of files) {
    const relative = file.slice(ROOT.length + 1).replace(/\\/g, "/");
    it(`${relative} calls a known authorization helper`, () => {
      const source = readFileSync(file, "utf8");
      assert.match(
        source,
        AUTHZ_PATTERN,
        `${relative} does not reference any known authz helper (${KNOWN_AUTHZ_HELPERS.join(", ")}). ` +
          "If this route truly doesn't need per-organization authorization, add its helper call or " +
          "explicitly exempt it here with a comment explaining why.",
      );
    });
  }
});
