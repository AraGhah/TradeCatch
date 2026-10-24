import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it, mock } from "node:test";
import {
  CLOUDFLARE_CRON_ROUTES,
  routesForCloudflareCron,
  runCloudflareCron,
  cloudflareSchedulerSecret,
} from "../../src/lib/cloudflare-scheduler";

describe("Cloudflare scheduler", () => {
  it("authenticates every scheduled route and never falls back to anonymous execution", () => {
    for (const path of Object.values(CLOUDFLARE_CRON_ROUTES).flat()) {
      assert.equal(
        cloudflareSchedulerSecret({ MISSED_CALL_OPS_SECRET: " ops " }, path),
        "ops",
      );
      assert.equal(
        cloudflareSchedulerSecret({ CRON_SECRET: " cron " }, path),
        "cron",
      );
      assert.throws(
        () => cloudflareSchedulerSecret({}, path),
        /credential is not configured/,
      );
    }
    assert.throws(
      () =>
        cloudflareSchedulerSecret({ CRON_SECRET: "secret" }, "/api/untrusted"),
      /Unknown scheduled route/,
    );
    const env = {
      MISSED_CALL_OPS_SECRET: "ops",
      BOOK_AUDIT_RETRY_SECRET: "booking",
      NOTIFICATION_RETRY_SECRET: "notifications",
      GMAIL_SYNC_SECRET: "gmail",
      MONITORING_SECRET: "monitoring",
    };
    for (const [path, expected] of [
      ["/api/book-audit/notifications/tick", "booking"],
      ["/api/gmail/sync/tick", "gmail"],
      ["/api/notifications/tick", "notifications"],
      ["/api/notifications/daily-summary/tick", "notifications"],
      ["/api/monitoring/tick", "monitoring"],
      ["/api/automations/tick", "ops"],
    ])
      assert.equal(cloudflareSchedulerSecret(env, path), expected);
    assert.equal(
      cloudflareSchedulerSecret(
        { CRON_SECRET: "fallback", MONITORING_SECRET: " " },
        "/api/monitoring/tick",
      ),
      "fallback",
    );
  });
  it("logs the failed route and stage without echoing sensitive error messages", async () => {
    const lines: string[] = [];
    const logger = mock.method(console, "error", (message: string) => {
      lines.push(message);
    });
    try {
      await assert.rejects(
        runCloudflareCron(
          "* * * * *",
          async (path) => {
            if (path.includes("gmail"))
              throw Object.assign(Error("Bearer sensitive-password"), {
                code: "28P01",
              });
            return Response.json(
              { ok: true },
              { status: path.includes("automations") ? 401 : 200 },
            );
          },
          async (path) => {
            if (path.includes("gmail"))
              throw Object.assign(Error("postgres://private:password@server"), {
                code: "28P01",
              });
          },
        ),
      );
      const events = lines.map((line) => JSON.parse(line));
      assert.ok(
        events.some(
          (e) =>
            e.event === "tradecatch.cron.route_failed" &&
            e.path === "/api/gmail/sync/tick" &&
            e.stage === "invoke" &&
            e.code === "28P01",
        ),
      );
      assert.ok(
        events.some(
          (e) =>
            e.event === "tradecatch.cron.observation_failed" &&
            e.path === "/api/gmail/sync/tick",
        ),
      );
      assert.ok(
        events.some(
          (e) => e.path === "/api/automations/tick" && e.httpStatus === 401,
        ),
      );
      assert.doesNotMatch(
        lines.join(""),
        /sensitive-password|postgres:\/\/|private:password/,
      );
    } finally {
      logger.mock.restore();
    }
  });
  it("does not treat HTTP 200 with failed work as a successful job", async () => {
    const results: boolean[] = [];
    await assert.rejects(
      runCloudflareCron(
        "* * * * *",
        async () => Response.json({ ok: true, failed: 1 }),
        async (_path, ok) => {
          results.push(ok);
        },
      ),
      /failed for/,
    );
    assert.ok(results.length > 0 && results.every((ok) => !ok));
  });
  it("records each actual result and continues after invocation failures", async () => {
    const results: { path: string; ok: boolean }[] = [];
    await assert.rejects(
      runCloudflareCron(
        "* * * * *",
        async (path) => {
          if (path.includes("gmail")) throw Error("network down");
          return new Response(null, {
            status: path.includes("automations") ? 503 : 200,
          });
        },
        async (path, ok) => {
          results.push({ path, ok });
        },
      ),
    );
    assert.equal(results.length, routesForCloudflareCron("* * * * *").length);
    assert.equal(results.filter((r) => !r.ok).length, 2);
    assert.equal(results.find((r) => r.path.includes("gmail"))?.ok, false);
  });
  it("maps each configured schedule to the expected internal routes", () => {
    assert.deepEqual(routesForCloudflareCron("* * * * *"), [
      "/api/book-audit/notifications/tick",
      "/api/gmail/sync/tick",
      "/api/missed-call/escalations/tick",
      "/api/automations/tick",
      "/api/notifications/tick",
    ]);
    assert.deepEqual(routesForCloudflareCron("*/15 * * * *"), [
      "/api/starter/quotes/tick",
      "/api/growth/reminders/tick",
      "/api/growth/reviews/tick",
      "/api/growth/crm/tick",
      "/api/receptionist/tick",
      "/api/notifications/daily-summary/tick",
      "/api/growth/email/tick",
      "/api/scheduling/reconcile",
      "/api/monitoring/tick",
    ]);
    assert.deepEqual(routesForCloudflareCron("15 6 * * *"), [
      "/api/missed-call/retention/tick",
    ]);
    assert.deepEqual(routesForCloudflareCron("0 0 1 1 *"), []);
  });

  it("keeps the Wrangler cron declarations synchronized with the route map", () => {
    const wrangler = fs.readFileSync("wrangler.jsonc", "utf8");
    for (const cron of Object.keys(CLOUDFLARE_CRON_ROUTES)) {
      assert.match(wrangler, new RegExp(`\"${cron.replaceAll("*", "\\*")}\"`));
    }
  });

  it("runs every route even when an earlier route fails", async () => {
    const invoked: string[] = [];

    await assert.rejects(
      runCloudflareCron("*/15 * * * *", async (path) => {
        invoked.push(path);
        return new Response(path.includes("reminders") ? "failed" : "ok", {
          status: path.includes("reminders") ? 503 : 200,
        });
      }),
      /failed for 1 route/,
    );

    assert.equal(
      invoked.length,
      routesForCloudflareCron("*/15 * * * *").length,
    );
  });

  it("returns the completed routes when every invocation succeeds", async () => {
    const result = await runCloudflareCron("* * * * *", async () =>
      Response.json({ ok: true }),
    );

    assert.deepEqual(result.completed, [
      "/api/book-audit/notifications/tick",
      "/api/gmail/sync/tick",
      "/api/missed-call/escalations/tick",
      "/api/automations/tick",
      "/api/notifications/tick",
    ]);
  });
});
