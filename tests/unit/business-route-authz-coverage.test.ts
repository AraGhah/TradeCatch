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

// Requires a *call* (name followed by "("), not just an import or mention
// in a comment, and is re-created per use since it carries the /g flag.
function authzCallPattern(): RegExp {
  return new RegExp(`\\b(${KNOWN_AUTHZ_HELPERS.join("|")})\\s*\\(`, "g");
}

const HANDLER_PATTERN =
  /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

/**
 * Splits a route file's source into one segment per exported HTTP handler
 * (GET/POST/PUT/PATCH/DELETE), each running from that handler's `export
 * async function X(` to the next handler's start (or EOF). A whole-file
 * text match would pass a route where only one of several handlers in the
 * same file calls the authz helper, or where the helper is merely imported
 * and never actually invoked — this per-handler, call-shaped check catches
 * both.
 */
function handlerSegments(
  source: string,
): { name: string; body: string }[] {
  const starts: { name: string; index: number }[] = [];
  for (const match of source.matchAll(HANDLER_PATTERN)) {
    starts.push({ name: match[1], index: match.index });
  }
  return starts.map((start, i) => ({
    name: start.name,
    body: source.slice(start.index, starts[i + 1]?.index ?? source.length),
  }));
}

const TOP_LEVEL_FN_PATTERN =
  /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm;

/**
 * Local module-scope wrapper functions (e.g. a per-file `gate()` that just
 * calls `requireSameBusiness` once and is reused by every handler) are a
 * legitimate pattern, not a gap — a handler calling such a wrapper counts
 * as calling the authz helper. Returns the names of wrapper functions,
 * defined before the first HTTP handler, whose own body calls a known
 * authz helper.
 */
function trustedLocalWrappers(source: string): Set<string> {
  const firstHandlerIndex = source.search(HANDLER_PATTERN);
  const preamble =
    firstHandlerIndex === -1 ? source : source.slice(0, firstHandlerIndex);
  const starts: { name: string; index: number }[] = [];
  for (const match of preamble.matchAll(TOP_LEVEL_FN_PATTERN)) {
    starts.push({ name: match[1], index: match.index });
  }
  const trusted = new Set<string>();
  starts.forEach((start, i) => {
    const body = preamble.slice(
      start.index,
      starts[i + 1]?.index ?? preamble.length,
    );
    if (authzCallPattern().test(body)) trusted.add(start.name);
  });
  return trusted;
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
    const source = readFileSync(file, "utf8");
    const segments = handlerSegments(source);
    const trustedWrappers = trustedLocalWrappers(source);

    it(`${relative} exports at least one HTTP handler`, () => {
      assert.ok(
        segments.length >= 1,
        `${relative} has no exported GET/POST/PUT/PATCH/DELETE handler for this scan to check`,
      );
    });

    for (const { name, body } of segments) {
      it(`${relative} → ${name} calls a known authorization helper`, () => {
        const callsHelperDirectly = authzCallPattern().test(body);
        const callsTrustedWrapper = [...trustedWrappers].some((wrapper) =>
          new RegExp(`\\b${wrapper}\\s*\\(`).test(body),
        );
        assert.ok(
          callsHelperDirectly || callsTrustedWrapper,
          `${relative}'s ${name} handler does not *call* any known authz helper ` +
            `(${KNOWN_AUTHZ_HELPERS.join(", ")}), directly or via a local wrapper that does — ` +
            "an import or a sibling handler's call does not count. If this handler truly doesn't need " +
            "per-organization authorization, add its helper call or explicitly exempt it here with a " +
            "comment explaining why.",
        );
      });
    }
  }
});
