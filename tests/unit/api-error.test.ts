import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { safeErrorResponse } from "../../src/lib/api-error";

const SECRET_DETAIL = 'relation "tc_users" does not exist at db.internal.example:6543 (password=hunter2)';

class FriendlyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let logged: unknown[][] = [];
const realError = console.error;
beforeEach(() => {
  logged = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
});
afterEach(() => {
  console.error = realError;
});

describe("safeErrorResponse", () => {
  it("hides the detail of an unexpected error and returns a request id", async () => {
    const request = new Request("https://example.test/api/x", { method: "POST", headers: { "cf-ray": "abc123-YUL" } });
    const res = await safeErrorResponse(new Error(SECRET_DETAIL), { route: "unit.route", request });
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.doesNotMatch(text, /tc_users|db\.internal|hunter2|password/);
    const body = JSON.parse(text) as { error: string; requestId: string };
    assert.equal(body.error, "Something went wrong. Please try again.");
    assert.match(body.requestId, /^req_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(res.headers.get("x-request-id"), body.requestId);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("keeps the real error, the route and the request id in the server log", async () => {
    const res = await safeErrorResponse(new Error(SECRET_DETAIL), {
      route: "unit.route",
      request: new Request("https://example.test/api/x", { method: "POST", headers: { "cf-ray": "abc123-YUL" } }),
    });
    const { requestId } = (await res.json()) as { requestId: string };
    const line = logged.map((args) => args.map(String).join(" ")).join("\n");
    assert.ok(line.includes(requestId), "log carries the id shown to the client");
    assert.ok(line.includes("unit.route"));
    assert.ok(line.includes("abc123-YUL"), "log carries the Cloudflare ray id");
    assert.ok(line.includes("hunter2"), "operators still get the full detail");
    assert.ok(line.includes("at "), "operators get the stack");
  });

  it("gives every failure its own id", async () => {
    const a = (await (await safeErrorResponse(new Error("a"), { route: "r" })).json()) as { requestId: string };
    const b = (await (await safeErrorResponse(new Error("b"), { route: "r" })).json()) as { requestId: string };
    assert.notEqual(a.requestId, b.requestId);
  });

  it("passes through only the listed domain errors, with their own status", async () => {
    const res = await safeErrorResponse(new FriendlyError("That pilot is already active.", 409), {
      route: "unit.route",
      publicErrors: [FriendlyError],
    });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: "That pilot is already active." });
    assert.equal(logged.length, 0, "an expected error is not an incident");
  });

  it("does not trust an error just because it carries a status", async () => {
    const res = await safeErrorResponse(new FriendlyError(SECRET_DETAIL, 502), { route: "unit.route" });
    assert.equal(res.status, 500);
    assert.doesNotMatch(await res.text(), /tc_users|hunter2/);
  });

  it("copes with something that is not an Error and honours a custom fallback", async () => {
    const res = await safeErrorResponse("just a string with a secret", { route: "unit.route", fallback: "Reset failed." });
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "Reset failed.");
  });
});

describe("a failing route", () => {
  it("monitoring/tick does not leak the database address when the database is down", async () => {
    const saved = { ...process.env };
    process.env.MISSED_CALL_OPS_SECRET = "unit-test-ops-secret-0123456789abcdef";
    process.env.DATABASE_URL = "postgresql://svc:topsecret@127.0.0.1:1/appdb";
    process.env.MISSED_CALL_DURABLE_STORE = "1";
    try {
      const { GET } = await import("../../src/app/api/monitoring/tick/route");
      const res = await GET(
        new NextRequest("http://localhost/api/monitoring/tick", {
          headers: { authorization: `Bearer ${process.env.MISSED_CALL_OPS_SECRET}`, "x-vercel-cron": "1" },
        }),
      );
      assert.equal(res.status, 500);
      const text = await res.text();
      assert.doesNotMatch(text, /127\.0\.0\.1|ECONNREFUSED|topsecret|appdb|connect/i);
      const body = JSON.parse(text) as { ok: boolean; error: string; requestId: string };
      assert.equal(body.ok, false);
      assert.equal(body.error, "monitor_check_failed");
      assert.match(body.requestId, /^req_/);
      assert.equal(res.headers.get("x-request-id"), body.requestId);
      const line = logged.map((args) => args.map(String).join(" ")).join("\n");
      assert.match(line, /ECONNREFUSED|127\.0\.0\.1/, "the real cause is in the server log");
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("no handler returns an arbitrary exception message", () => {
  it("has no `instanceof Error ? e.message` outside logging", () => {
    const root = join(__dirname, "..", "..", "src", "app");
    const files = sourceFiles(root);
    assert.ok(files.length > 100, `scanned ${files.length} files`);
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (/instanceof Error \? (err|error|e)\.message/.test(line) && !/console\.(warn|error|info|log)/.test(line)) {
            offenders.push(`${file}:${index + 1}`);
          }
        });
    }
    assert.deepEqual(offenders, []);
  });
});
