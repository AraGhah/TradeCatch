/**
 * KAN-28 the administrator email notifier: who receives alerts, how a finished
 * payload becomes emails, and what happens when sending is not possible.
 * The email provider is the only stub.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AlertNotConfiguredError, type AlertPayload } from "../../src/product/reliability/alerts";
import {
  createAdminAlertNotifier,
  resolveAlertRecipients,
} from "../../src/product/reliability/notify";

const payload = (over: Partial<AlertPayload> = {}): AlertPayload => ({
  kind: "opened",
  priority: "critical",
  severity: "critical",
  title: "Website is unreachable",
  subject: "[TradeCatch CRITICAL] Website is unreachable",
  lines: [
    { label: "Service", value: "Website" },
    { label: "Diagnostic reference", value: "inc_123" },
  ],
  ctaUrl: "https://example.test/admin/system-health?incident=inc_123",
  incidentId: "inc_123",
  simulated: false,
  idempotencyKey: "tc-alert-a1-1",
  ...over,
});

type Sent = { toEmail: string; subject: string; title: string; idempotencyKey?: string; ctaUrl?: string; ctaLabel?: string; lines: { label: string; value?: string | null }[] };

function notifier(env: Record<string, string | undefined>, result: (to: string) => { sent: boolean; reason?: string } = () => ({ sent: true })) {
  const sent: Sent[] = [];
  const notify = createAdminAlertNotifier({
    env,
    send: async (input) => {
      sent.push(input as Sent);
      return result(input.toEmail);
    },
  });
  return { notify, sent };
}

describe("who is alerted", () => {
  it("uses ADMIN_ALERT_EMAIL first, then RESEND_NOTIFY_EMAIL, then the platform administrators", () => {
    assert.deepEqual(
      resolveAlertRecipients({ ADMIN_ALERT_EMAIL: "ops@example.test", RESEND_NOTIFY_EMAIL: "other@example.test", TRADECATCH_ADMIN_EMAILS: "boss@example.test" }),
      ["ops@example.test"],
    );
    assert.deepEqual(resolveAlertRecipients({ RESEND_NOTIFY_EMAIL: "other@example.test", TRADECATCH_ADMIN_EMAILS: "boss@example.test" }), ["other@example.test"]);
    assert.deepEqual(resolveAlertRecipients({ TRADECATCH_ADMIN_EMAILS: "boss@example.test,Helper@Example.test:support" }), ["boss@example.test", "helper@example.test"]);
  });

  it("accepts a comma-separated list, ignores junk and repeats, and caps the list", () => {
    assert.deepEqual(
      resolveAlertRecipients({ ADMIN_ALERT_EMAIL: " a@example.test , not-an-email,A@example.test,; b@example.test " }),
      ["a@example.test", "b@example.test"],
    );
    const many = Array.from({ length: 12 }, (_, i) => `u${i}@example.test`).join(",");
    assert.equal(resolveAlertRecipients({ ADMIN_ALERT_EMAIL: many }).length, 5);
  });

  it("is empty when nothing is configured", () => {
    assert.deepEqual(resolveAlertRecipients({}), []);
    assert.deepEqual(resolveAlertRecipients({ ADMIN_ALERT_EMAIL: "   " }), []);
  });
});

describe("sending an alert", () => {
  it("sends the finished payload as it is, with a link back to the dashboard", async () => {
    const { notify, sent } = notifier({ ADMIN_ALERT_EMAIL: "ops@example.test" });
    await notify(payload());
    assert.equal(sent.length, 1);
    assert.equal(sent[0].toEmail, "ops@example.test");
    assert.equal(sent[0].subject, "[TradeCatch CRITICAL] Website is unreachable");
    assert.equal(sent[0].title, "Website is unreachable");
    assert.deepEqual(sent[0].lines, payload().lines);
    assert.equal(sent[0].ctaUrl, "https://example.test/admin/system-health?incident=inc_123");
    assert.ok(sent[0].ctaLabel);
  });

  it("sends one email per recipient, each with its own idempotency key", async () => {
    const { notify, sent } = notifier({ ADMIN_ALERT_EMAIL: "a@example.test,b@example.test" });
    await notify(payload());
    assert.deepEqual(sent.map((s) => s.toEmail), ["a@example.test", "b@example.test"]);
    const keys = sent.map((s) => s.idempotencyKey);
    assert.equal(new Set(keys).size, 2);
    assert.ok(keys.every((key) => key?.startsWith("tc-alert-a1-1")));
  });

  it("MON-12: a failure for one recipient does not stop the others, and the whole send is reported as failed so it is retried", async () => {
    const { notify, sent } = notifier(
      { ADMIN_ALERT_EMAIL: "a@example.test,b@example.test" },
      (to) => (to === "a@example.test" ? { sent: false, reason: "smtp 550 mailbox for secret@corp.example full" } : { sent: true }),
    );
    await assert.rejects(() => notify(payload()), (error: Error) => {
      assert.doesNotMatch(error.message, /secret@corp|550|mailbox/, "the provider's text is not carried into the error");
      return true;
    });
    assert.equal(sent.length, 2, "the second recipient was still attempted");
  });

  it("never sends a simulated alert", async () => {
    const { notify, sent } = notifier({ ADMIN_ALERT_EMAIL: "ops@example.test" });
    await notify(payload({ simulated: true }));
    assert.equal(sent.length, 0);
  });

  it("says it is not configured, instead of failing mysteriously, when nobody can be told", async () => {
    const none = notifier({});
    await assert.rejects(() => none.notify(payload()), AlertNotConfiguredError);
    const noProvider = notifier({ ADMIN_ALERT_EMAIL: "ops@example.test" }, () => ({ sent: false, reason: "resend_not_configured" }));
    await assert.rejects(() => noProvider.notify(payload()), AlertNotConfiguredError);
  });

  it("omits the link when the payload has none", async () => {
    const { notify, sent } = notifier({ ADMIN_ALERT_EMAIL: "ops@example.test" });
    await notify(payload({ ctaUrl: undefined }));
    assert.equal(sent[0].ctaUrl, undefined);
    assert.equal(sent[0].ctaLabel, undefined);
  });
});
