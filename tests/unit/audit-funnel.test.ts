import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuditFunnel } from "../../src/lib/audit-funnel";

test("funnel requires analytics consent, deduplicates abandonment and suppresses it after success", () => {
  let allowed = false,
    now = 0;
  const events: { event: string; params: Record<string, string | number> }[] =
    [];
  const funnel = createAuditFunnel({
    locale: "fr",
    allowed: () => allowed,
    now: () => now,
    track: (event, params) => events.push({ event, params }),
  });
  funnel.touch();
  funnel.abandon("hidden");
  assert.equal(events.length, 0);
  allowed = true;
  funnel.touch();
  funnel.touch();
  funnel.view("contact");
  now = 12000;
  funnel.abandon("hidden");
  funnel.abandon("pagehide");
  funnel.abandon("navigation");
  assert.equal(
    events.filter((row) => row.event === "audit_form_started").length,
    1,
  );
  assert.equal(
    events.filter((row) => row.event === "audit_form_abandoned").length,
    1,
  );
  assert.equal(events.at(-1)?.params.elapsed_seconds, 12);
  assert.equal(events.at(-1)?.params.step, "contact");
  funnel.touch();
  funnel.complete();
  funnel.abandon("pagehide");
  assert.equal(
    events.filter((row) => row.event === "audit_form_resumed").length,
    1,
  );
  assert.equal(events.at(-1)?.event, "audit_form_completed");
  for (const { params } of events)
    assert.ok(
      Object.keys(params).every((key) =>
        [
          "locale",
          "form_version",
          "step",
          "reason",
          "elapsed_seconds",
        ].includes(key),
      ),
    );
});

test("consent withdrawal prevents later funnel telemetry", () => {
  let allowed = true;
  const events: string[] = [];
  const funnel = createAuditFunnel({
    locale: "en",
    allowed: () => allowed,
    track: (event) => events.push(event),
  });
  funnel.touch();
  const count = events.length;
  allowed = false;
  funnel.view("contact");
  funnel.abandon("navigation");
  funnel.complete();
  assert.equal(events.length, count);
});
