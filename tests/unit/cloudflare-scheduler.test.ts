import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  CLOUDFLARE_CRON_ROUTES,
  routesForCloudflareCron,
  runCloudflareCron,
} from "../../src/lib/cloudflare-scheduler";

describe("Cloudflare scheduler", () => {
  it("maps each configured schedule to the expected internal routes", () => {
    assert.deepEqual(routesForCloudflareCron("* * * * *"), [
      "/api/missed-call/escalations/tick",
    ]);
    assert.deepEqual(routesForCloudflareCron("*/15 * * * *"), [
      "/api/starter/quotes/tick",
      "/api/growth/reminders/tick",
      "/api/growth/reviews/tick",
      "/api/growth/crm/tick",
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

    assert.equal(invoked.length, 4);
  });

  it("returns the completed routes when every invocation succeeds", async () => {
    const result = await runCloudflareCron("* * * * *", async () =>
      Response.json({ ok: true }),
    );

    assert.deepEqual(result.completed, ["/api/missed-call/escalations/tick"]);
  });
});
