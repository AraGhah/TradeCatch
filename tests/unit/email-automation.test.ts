import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEmailAutomationServices,
  createMemoryEmailAutomationStore,
  createMemoryEmailPort,
  createUnsubscribeToken,
  EmailAutomationError,
  renderTemplate,
  validateTemplate,
  verifyUnsubscribeToken,
} from "../../src/product/email-automation";

const ORG = "org_a";
const HOUR = 60 * 60 * 1000;

function setup(start = new Date("2026-03-04T15:00:00Z")) {
  const store = createMemoryEmailAutomationStore();
  const email = createMemoryEmailPort();
  const clock = { current: start };
  const services = createEmailAutomationServices({
    store,
    email,
    clock: { now: () => clock.current },
    orgContext: async (org) =>
      org === "org_none"
        ? null
        : { businessName: "Nord Plomberie", fromEmail: "Nord Plomberie <bonjour@nord.example>", replyTo: "owner@nord.example", locale: "fr" },
    unsubscribeUrl: (org, addr) => `https://tradecatch.test/api/email/unsubscribe?t=${org}:${addr}`,
  });
  return { store, email, clock, services };
}

async function seedSequence(services: ReturnType<typeof setup>["services"], org = ORG) {
  const t1 = await services.saveTemplate({
    organizationId: org,
    name: "one",
    locale: "fr",
    subject: "Soumission {{ quote_ref }}",
    body: "Bonjour {{ first_name | default:\"\" }},\n\nMerci pour votre demande{% if service %} de {{ service }}{% endif %}.",
  });
  const t2 = await services.saveTemplate({
    organizationId: org,
    name: "two",
    locale: "fr",
    subject: "Suivi",
    body: "Toujours intéressé?\n\n{{ business_name }}",
  });
  const sequence = await services.saveSequence({
    organizationId: org,
    name: "seq",
    steps: [
      { templateId: t1.id, delayHours: 48 },
      { templateId: t2.id, delayHours: 72 },
    ],
  });
  return { t1, t2, sequence };
}

describe("email template engine", () => {
  it("renders variables, filters and conditionals", () => {
    const src = 'Hello {{ name | default:"there" | capitalize }}!{% if vip == "yes" %} VIP{% elif amount %} ${{ amount }}{% else %} std{% endif %}';
    assert.equal(renderTemplate(src, {}), "Hello There! std");
    assert.equal(renderTemplate(src, { name: "marie", vip: "yes" }), "Hello Marie! VIP");
    assert.equal(renderTemplate(src, { name: "marie", amount: 250 }), "Hello Marie! $250");
    assert.equal(renderTemplate("{% if not x %}none{% endif %}", {}), "none");
    assert.equal(renderTemplate("{{ a | upper }}-{{ b | lower }}", { a: "x", b: "Y" }), "X-y");
  });

  it("escapes HTML in html mode only", () => {
    const vars = { name: `<img src=x onerror=alert(1)> & "q"` };
    assert.equal(renderTemplate("{{ name }}", vars, { html: true }), "&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;");
    assert.ok(renderTemplate("{{ name }}", vars).includes("<img"));
  });

  it("never evaluates code and treats unknown variables as empty", () => {
    assert.equal(renderTemplate("{{ constructor }}|{{ __proto__ }}", {}), "|");
    const check = validateTemplate("{{ process.env.SECRET }}");
    assert.equal(check.ok, false);
  });

  it("reports syntax errors and the variables a template uses", () => {
    assert.equal(validateTemplate("{% if a %}x").ok, false);
    assert.equal(validateTemplate("{% endif %}").ok, false);
    assert.equal(validateTemplate("{% for x in y %}").ok, false);
    assert.equal(validateTemplate("{{ a | nope }}").ok, false);
    assert.deepEqual(validateTemplate("{{ b }}{% if a %}{{ c }}{% endif %}").variables, ["a", "b", "c"]);
  });
});

describe("email sequences", () => {
  it("rejects invalid templates and sequences up front", async () => {
    const { services } = setup();
    await assert.rejects(
      () => services.saveTemplate({ organizationId: ORG, name: "x", locale: "en", subject: "{{", body: "b" }),
      (e) => e instanceof EmailAutomationError && e.code === "invalid_template",
    );
    await assert.rejects(
      () => services.saveSequence({ organizationId: ORG, name: "x", steps: [] }),
      (e) => e instanceof EmailAutomationError && e.code === "invalid_steps",
    );
    await assert.rejects(
      () => services.saveSequence({ organizationId: ORG, name: "x", steps: [{ templateId: "nope", delayHours: 1 }] }),
      (e) => e instanceof EmailAutomationError && e.code === "unknown_template",
    );
  });

  it("sends step 1 after its delay, step 2 after the next delay, then completes", async () => {
    const { services, email, clock, store } = setup();
    const { sequence } = await seedSequence(services);
    const e = await services.enroll({
      organizationId: ORG,
      sequenceId: sequence.id,
      email: "Marie@Example.com ",
      name: "Marie Tremblay",
      vars: { quote_ref: "Q-7", service: "thermopompe" },
    });
    assert.equal(e.email, "marie@example.com");

    assert.deepEqual(await services.processDue(), { sent: 0, failed: 0, completed: 0, stopped: 0 });

    clock.current = new Date(clock.current.getTime() + 49 * HOUR);
    assert.equal((await services.processDue()).sent, 1);
    const first = email.sent[0]!;
    assert.equal(first.to, "marie@example.com");
    assert.equal(first.from, "Nord Plomberie <bonjour@nord.example>");
    assert.equal(first.replyTo, "owner@nord.example");
    assert.equal(first.subject, "Soumission Q-7");
    assert.match(first.text, /Bonjour Marie,/);
    assert.match(first.text, /de thermopompe/);
    assert.match(first.text, /Se désabonner/);
    assert.match(first.html, /<a href="https:\/\/tradecatch\.test\/api\/email\/unsubscribe/);
    assert.match(first.headers!["List-Unsubscribe"]!, /^<https:\/\/tradecatch\.test/);
    assert.equal(first.headers!["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");

    // Not due again yet.
    assert.equal((await services.processDue()).sent, 0);

    clock.current = new Date(clock.current.getTime() + 73 * HOUR);
    const r = await services.processDue();
    assert.equal(r.sent, 1);
    assert.equal(r.completed, 1);
    assert.equal(email.sent[1]!.subject, "Suivi");

    const done = (await store.getEnrollment(e.id, ORG))!;
    assert.equal(done.status, "completed");
    assert.equal(done.history.length, 2);
    assert.equal((await services.processDue()).sent, 0);
  });

  it("stops on reply and on unsubscribe, and blocks re-enrollment", async () => {
    const { services, email, clock, store } = setup();
    const { sequence } = await seedSequence(services);
    const a = await services.enroll({ organizationId: ORG, sequenceId: sequence.id, email: "a@x.com", vars: { quote_ref: "1" } });
    const b = await services.enroll({ organizationId: ORG, sequenceId: sequence.id, email: "b@x.com", vars: { quote_ref: "2" } });

    assert.equal(await services.markReplied(ORG, "A@x.com"), 1);
    assert.equal((await store.getEnrollment(a.id, ORG))!.stopReason, "replied");

    assert.equal(await services.unsubscribe(ORG, "b@x.com"), 1);
    assert.equal((await store.getEnrollment(b.id, ORG))!.stopReason, "unsubscribed");

    clock.current = new Date(clock.current.getTime() + 500 * HOUR);
    assert.equal((await services.processDue()).sent, 0);
    assert.equal(email.sent.length, 0);

    await assert.rejects(
      () => services.enroll({ organizationId: ORG, sequenceId: sequence.id, email: "b@x.com" }),
      (e) => e instanceof EmailAutomationError && e.code === "suppressed",
    );
  });

  it("prevents duplicate active enrollments and pausing a sequence stops sends", async () => {
    const { services, email, clock } = setup();
    const { sequence } = await seedSequence(services);
    await services.enroll({ organizationId: ORG, sequenceId: sequence.id, email: "a@x.com", vars: { quote_ref: "1" } });
    await assert.rejects(
      () => services.enroll({ organizationId: ORG, sequenceId: sequence.id, email: "a@x.com" }),
      (e) => e instanceof EmailAutomationError && e.code === "already_enrolled",
    );

    await services.saveSequence({ organizationId: ORG, id: sequence.id, name: sequence.name, steps: sequence.steps, active: false });
    clock.current = new Date(clock.current.getTime() + 60 * HOUR);
    const r = await services.processDue();
    assert.equal(r.stopped, 1);
    assert.equal(email.sent.length, 0);
    await assert.rejects(
      () => services.enroll({ organizationId: ORG, sequenceId: sequence.id, email: "c@x.com" }),
      (e) => e instanceof EmailAutomationError && e.code === "sequence_inactive",
    );
  });

  it("retries failed sends with backoff and gives up after 3 attempts", async () => {
    const { services, clock, store } = setup();
    const failing = createEmailAutomationServices({
      store,
      email: {
        async send() {
          throw new Error("resend down");
        },
      },
      clock: { now: () => clock.current },
      orgContext: async () => ({ businessName: "N", fromEmail: "n@n.example", locale: "fr" }),
      unsubscribeUrl: () => "https://u.test",
    });
    const { sequence } = await seedSequence(services);
    const e = await failing.enroll({ organizationId: ORG, sequenceId: sequence.id, email: "a@x.com", vars: { quote_ref: "1" } });

    clock.current = new Date(clock.current.getTime() + 49 * HOUR);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const r = await failing.processDue();
      assert.equal(r.failed, 1, `attempt ${attempt}`);
      clock.current = new Date(clock.current.getTime() + 2 * HOUR);
    }
    const row = (await store.getEnrollment(e.id, ORG))!;
    assert.equal(row.status, "failed");
    assert.equal(row.currentStep, 0);
    assert.equal(row.history.filter((h) => !h.ok).length, 3);
    assert.equal((await failing.processDue()).failed, 0);
  });

  it("leases due enrollments so overlapping ticks never double-send", async () => {
    const { services, email, clock } = setup();
    const { sequence } = await seedSequence(services);
    await services.enroll({ organizationId: ORG, sequenceId: sequence.id, email: "a@x.com", vars: { quote_ref: "1" } });
    clock.current = new Date(clock.current.getTime() + 49 * HOUR);
    const [r1, r2] = await Promise.all([services.processDue(), services.processDue()]);
    assert.equal(r1.sent + r2.sent, 1);
    assert.equal(email.sent.length, 1);
  });

  it("isolates organizations", async () => {
    const { services, store } = setup();
    const { sequence, t1 } = await seedSequence(services);
    assert.equal(await store.getSequence(sequence.id, "org_b"), null);
    assert.equal(await store.getTemplate(t1.id, "org_b"), null);
    await assert.rejects(
      () => services.enroll({ organizationId: "org_b", sequenceId: sequence.id, email: "a@x.com" }),
      (e) => e instanceof EmailAutomationError && e.code === "unknown_sequence",
    );
    await assert.rejects(
      () => services.saveSequence({ organizationId: "org_b", name: "x", steps: [{ templateId: t1.id, delayHours: 1 }] }),
      (e) => e instanceof EmailAutomationError && e.code === "unknown_template",
    );
  });

  it("seeds bilingual defaults once and previews with the org identity", async () => {
    const { services, store } = setup();
    await services.ensureDefaults(ORG);
    await services.ensureDefaults(ORG);
    assert.equal((await store.listTemplates(ORG)).length, 4);
    const sequences = await store.listSequences(ORG);
    assert.equal(sequences.length, 2);
    assert.equal(sequences[0]!.steps.length, 2);

    const preview = await services.preview({
      organizationId: ORG,
      subject: "Hi {{ first_name }}",
      body: "About {{ quote_ref }} from {{ business_name }}",
      name: "Marie Tremblay",
      vars: { quote_ref: "Q-9" },
    });
    assert.equal(preview.subject, "Hi Marie");
    assert.match(preview.text, /About Q-9 from Nord Plomberie/);
    assert.deepEqual(preview.variables, ["business_name", "first_name", "quote_ref"]);
  });

  it("fails a send (does not fake success) when the org has no sender identity", async () => {
    const { services, store, clock } = setup();
    const { sequence } = await seedSequence(services, "org_none");
    const e = await services.enroll({ organizationId: "org_none", sequenceId: sequence.id, email: "a@x.com", vars: { quote_ref: "1" } });
    clock.current = new Date(clock.current.getTime() + 49 * HOUR);
    const r = await services.processDue();
    assert.equal(r.failed, 1);
    assert.match((await store.getEnrollment(e.id, "org_none"))!.history[0]!.error!, /org_context_missing/);
  });
});

describe("unsubscribe tokens", () => {
  it("round-trips and rejects tampering", () => {
    const token = createUnsubscribeToken({ organizationId: "org_a", email: "A@x.com" }, "secret-1");
    assert.deepEqual(verifyUnsubscribeToken(token, "secret-1"), { organizationId: "org_a", email: "a@x.com" });
    assert.equal(verifyUnsubscribeToken(token, "secret-2"), null);
    const [payload, sig] = token.split(".");
    const forged = `${Buffer.from("org_b\na@x.com").toString("base64url")}.${sig}`;
    assert.equal(verifyUnsubscribeToken(forged, "secret-1"), null);
    assert.equal(verifyUnsubscribeToken(`${payload}.`, "secret-1"), null);
    assert.equal(verifyUnsubscribeToken("garbage", "secret-1"), null);
  });
});

describe("auto-enroll website leads", () => {
  const lead = (over: Record<string, unknown> = {}) => ({
    id: "wlead_1",
    name: "Marie Tremblay",
    email: "Marie@Example.com",
    consentAt: "2026-03-04T15:00:00.000Z",
    serviceRequested: "thermopompe",
    message: "Je veux une soumission",
    status: "new",
    ...over,
  });

  it("does nothing until the org picks a sequence (off by default)", async () => {
    const { services, store } = setup();
    await seedSequence(services);
    const r = await services.autoEnrollWebsiteLead({ organizationId: ORG, lead: lead() });
    assert.deepEqual(r, { enrolled: false, reason: "not_configured" });
    assert.equal((await store.listEnrollments(ORG)).length, 0);
  });

  it("enrolls a consenting lead with its service and message as template variables", async () => {
    const { services, store, email, clock } = setup();
    const { sequence } = await seedSequence(services);
    await services.setAutoEnroll(ORG, sequence.id);

    const r = await services.autoEnrollWebsiteLead({ organizationId: ORG, lead: lead() });
    assert.equal(r.enrolled, true);
    const e = (await store.getEnrollment(r.enrollmentId!, ORG))!;
    assert.equal(e.email, "marie@example.com");
    assert.equal(e.source, "website_lead");
    assert.equal(e.sourceRefId, "wlead_1");
    assert.equal(e.vars.service, "thermopompe");

    // The seeded first template uses {{ service }} — it flows through to the email.
    clock.current = new Date(clock.current.getTime() + 49 * HOUR);
    await services.processDue();
    assert.match(email.sent[0]!.text, /de thermopompe/);
  });

  it("requires an email and express consent, and skips spam", async () => {
    const { services, store } = setup();
    const { sequence } = await seedSequence(services);
    await services.setAutoEnroll(ORG, sequence.id);

    assert.equal((await services.autoEnrollWebsiteLead({ organizationId: ORG, lead: lead({ email: undefined }) })).reason, "no_email");
    assert.equal((await services.autoEnrollWebsiteLead({ organizationId: ORG, lead: lead({ email: "  " }) })).reason, "no_email");
    assert.equal((await services.autoEnrollWebsiteLead({ organizationId: ORG, lead: lead({ consentAt: undefined }) })).reason, "no_consent");
    assert.equal((await services.autoEnrollWebsiteLead({ organizationId: ORG, lead: lead({ status: "spam" }) })).reason, "spam");
    assert.equal((await store.listEnrollments(ORG)).length, 0);
  });

  it("never re-enrolls duplicates or unsubscribed contacts, and respects a paused sequence", async () => {
    const { services } = setup();
    const { sequence } = await seedSequence(services);
    await services.setAutoEnroll(ORG, sequence.id);

    assert.equal((await services.autoEnrollWebsiteLead({ organizationId: ORG, lead: lead() })).enrolled, true);
    assert.equal((await services.autoEnrollWebsiteLead({ organizationId: ORG, lead: lead() })).reason, "already_enrolled");

    await services.unsubscribe(ORG, "marie@example.com");
    assert.equal((await services.autoEnrollWebsiteLead({ organizationId: ORG, lead: lead() })).reason, "suppressed");

    await services.saveSequence({ organizationId: ORG, id: sequence.id, name: sequence.name, steps: sequence.steps, active: false });
    assert.equal((await services.autoEnrollWebsiteLead({ organizationId: ORG, lead: lead({ email: "new@example.com" }) })).reason, "sequence_inactive");
  });

  it("only accepts a sequence of the same organization and can be turned off", async () => {
    const { services, store } = setup();
    const { sequence } = await seedSequence(services);
    await assert.rejects(
      () => services.setAutoEnroll("org_other", sequence.id),
      (e) => e instanceof EmailAutomationError && e.code === "unknown_sequence",
    );
    assert.deepEqual(await services.setAutoEnroll(ORG, sequence.id), { autoEnrollSequenceId: sequence.id });
    assert.deepEqual(await services.setAutoEnroll(ORG, null), {});
    assert.deepEqual(await store.getOrgSettings(ORG), {});
    assert.equal((await services.autoEnrollWebsiteLead({ organizationId: ORG, lead: lead() })).reason, "not_configured");
  });
});
