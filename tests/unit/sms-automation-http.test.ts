import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { automationFailure } from "../../src/product/sms-automation/http";
import { AutomationError } from "../../src/product/sms-automation/service";

const SECRET = 'relation "tc_sms_automations" does not exist at db.internal.example:6543 (password=hunter2)';

const realError = console.error;
beforeEach(() => {
  console.error = () => {};
});
afterEach(() => {
  console.error = realError;
});

describe("automation route failures reach the screen as readable JSON", () => {
  it("a refused setting keeps its status, its sentence and the settings it names", async () => {
    const response = await automationFailure(
      new AutomationError("Invalid settings: max_attempts", 400, ["max_attempts"]),
      "settings",
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Invalid settings: max_attempts",
      fields: ["max_attempts"],
    });
  });

  it("a missing automation is a 404 with a message", async () => {
    const response = await automationFailure(new AutomationError("Automation not found.", 404), "activate");
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Automation not found." });
  });

  it("a database error is a 500 with a plain sentence and a request id, never the internals", async () => {
    const response = await automationFailure(new Error(SECRET), "deactivate");
    assert.equal(response.status, 500);
    const text = JSON.stringify(await response.clone().json());
    assert.doesNotMatch(text, /tc_sms_automations|hunter2|db\.internal/);
    const body = (await response.json()) as { error: string; requestId: string };
    assert.match(body.error, /could not be saved/i);
    assert.match(body.requestId, /^req_/);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});
