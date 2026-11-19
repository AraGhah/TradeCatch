import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..", "..");
const ADMIN_ROUTES_DIR = join(ROOT, "src", "app", "api", "admin");

/**
 * The only two ways an /api/admin handler may decide who is calling. Both end in
 * authorizeAdminRequest (MFA-verified platform administrator + role, or the
 * operations secret); guardAdmin adds the cross-site check and the
 * per-administrator rate limit for changes.
 */
const ADMIN_GUARDS = ["guardAdmin", "authorizeAdminRequest"];

const guardCall = () => new RegExp(`\\b(${ADMIN_GUARDS.join("|")})\\s*\\(`);
const HANDLER = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

function segments(source: string) {
  const starts = [...source.matchAll(HANDLER)].map((m) => ({
    name: m[1],
    index: m.index ?? 0,
  }));
  return starts.map((start, i) => ({
    name: start.name,
    body: source.slice(start.index, starts[i + 1]?.index ?? source.length),
  }));
}

const TOP_LEVEL_FN = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm;

/**
 * Module-scope helpers (defined before the first handler) whose own body calls a
 * guard, e.g. a per-file `access(request)`. A handler calling one counts as
 * calling the guard, exactly as in business-route-authz-coverage.test.ts.
 */
function guardWrappers(source: string): string[] {
  const first = source.search(new RegExp(HANDLER.source));
  const preamble = first === -1 ? source : source.slice(0, first);
  const starts = [...preamble.matchAll(TOP_LEVEL_FN)].map((m) => ({
    name: m[1],
    index: m.index ?? 0,
  }));
  return starts
    .filter((start, i) =>
      guardCall().test(
        preamble.slice(start.index, starts[i + 1]?.index ?? preamble.length),
      ),
    )
    .map((start) => start.name);
}

/**
 * Admin routes hold every customer's data and can change billing, so "does this
 * handler check the caller" is not left to review: each exported handler must
 * actually CALL a guard (an import or a comment does not count), and must do so
 * before it reads the request body or touches data. This is the admin-tree
 * counterpart of business-route-authz-coverage.test.ts.
 */
describe("every /api/admin route authenticates and authorizes its caller", () => {
  const files = routeFiles(ADMIN_ROUTES_DIR);

  it("found the admin routes (the scan did not silently match nothing)", () => {
    assert.ok(files.length >= 40, `found only ${files.length} admin route files`);
  });

  it("covers the console routes this work added", () => {
    const relative = files.map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/"));
    for (const expected of [
      "src/app/api/admin/overview/route.ts",
      "src/app/api/admin/businesses/route.ts",
      "src/app/api/admin/subscriptions/route.ts",
      "src/app/api/admin/subscriptions/[id]/route.ts",
      "src/app/api/admin/payments/route.ts",
      "src/app/api/admin/website-requests/route.ts",
      "src/app/api/admin/health/route.ts",
      "src/app/api/admin/audit-logs/route.ts",
    ]) {
      assert.ok(relative.includes(expected), `${expected} is missing`);
    }
  });

  for (const file of files) {
    const relative = file.slice(ROOT.length + 1).replace(/\\/g, "/");
    const source = readFileSync(file, "utf8");
    const found = segments(source);
    const wrappers = guardWrappers(source);
    const callsGuard = (body: string) =>
      new RegExp(
        `\\b(${[...ADMIN_GUARDS, ...wrappers].join("|")})\\s*\\(`,
      ).exec(body);

    it(`${relative} exports at least one HTTP handler`, () => {
      assert.ok(found.length >= 1);
    });

    for (const { name, body } of found) {
      it(`${relative} → ${name} calls an admin guard before anything else`, () => {
        const match = callsGuard(body);
        assert.ok(
          match,
          `${relative}'s ${name} handler never calls ${ADMIN_GUARDS.join(" or ")} (directly or through a local wrapper that does)`,
        );
        // The guard comes before the request body is read or any store is used.
        const guardAt = match.index;
        for (const early of [
          /\.json\s*\(/,
          /readJsonBody\s*\(/,
          /readJsonBounded\s*\(/,
          /getSaasStore\s*\(/,
          /getSecurityService\s*\(/,
          /getWebsiteRequestService\s*\(/,
          /getReliabilityService\s*\(/,
        ]) {
          const at = body.search(early);
          assert.ok(
            at === -1 || at > guardAt,
            `${relative}'s ${name} handler touches the request or data (${early}) before its admin guard`,
          );
        }
      });
    }
  }

  it("never lets a console route authorize with only a session cookie check", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(
        source,
        /cookies\(\)\.get\(["']tc_session|getSessionFromRequest\s*\(/,
        `${file} reads the session itself instead of using the admin guard`,
      );
    }
  });
});
