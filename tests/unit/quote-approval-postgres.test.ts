/**
 * Quote follow-up approval through the REAL Postgres stores. The in-memory suite
 * (quote-wording-approval.test.ts) proves the rules; this proves the stored
 * state behaves the same: held until approved, per business, withdrawable, the
 * Day 1 / 3 / 7 / 14 schedule advances, and unrelated settings edits do not
 * invalidate an approval. Needs a disposable database named *_staging with the
 * schema applied (npm run db:schema), given as QUOTE_APPROVAL_TEST_DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { createPostgresGrowthStore } from "../../src/product/growth/postgres-store";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import {
  createStarterServices,
  DEFAULT_QUOTE_STEPS_MS,
} from "../../src/product/starter";
import { createPostgresStarterStore } from "../../src/product/starter/postgres-store";

const url = process.env.QUOTE_APPROVAL_TEST_DATABASE_URL?.trim();
const disposable = url ? /_staging$/.test(new URL(url).pathname) : false;

const tick = {
  businessNameForOrg: async () => "Nord Plumbing",
  smsFromForOrg: async () => "+15145550999",
};

describe("quote follow-up approval (real PostgreSQL)", { skip: !url }, () => {
  const suffix = randomBytes(4).toString("hex");
  const orgA = `org_qa_a_${suffix}`;
  const orgB = `org_qa_b_${suffix}`;
  let pool: Pool;

  before(async () => {
    assert.ok(disposable, "Refusing to touch a database not named *_staging");
    pool = new Pool({ connectionString: url, max: 2 });
    for (const id of [orgA, orgB]) {
      await pool.query(
        `INSERT INTO tc_organizations (id, name, slug) VALUES ($1, $2, $3)`,
        [id, `Business ${id}`, `slug-${id}`],
      );
    }
  });

  after(async () => {
    if (pool) {
      await pool.query(`DELETE FROM tc_organizations WHERE id = ANY($1)`, [[orgA, orgB]]);
      await pool.end();
    }
  });

  it("holds until the owner approves, is per business, and walks Day 1 / 3 / 7 / 14", async () => {
    const starter = createPostgresStarterStore(url!);
    const growth = createPostgresGrowthStore(url!);
    const sms = createMemorySmsPort();
    const services = createStarterServices({ store: starter, sms, growth });

    const quoteSentAt = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const threads: Record<string, string> = {};
    for (const [org, phone] of [
      [orgA, "+15145550101"],
      [orgB, "+15145550102"],
    ] as const) {
      const thread = await services.ingestQuote({
        organizationId: org,
        customerPhoneE164: phone,
        customerName: "Sam",
        locale: "en",
        quoteSentAt,
      });
      threads[org] = thread.id;
      await starter.updateQuoteThread(thread.id, org, {
        nextRunAt: new Date(Date.now() - 1000).toISOString(),
        nextStepIndex: 0,
      });
    }
    const stepOf = async (org: string) =>
      (await starter.getQuoteThread(threads[org]!, org))!;
    const makeDue = (org: string) =>
      starter.updateQuoteThread(threads[org]!, org, {
        nextRunAt: new Date(Date.now() - 1000).toISOString(),
      });

    // Nothing is sent before approval.
    let result = await services.processDueQuotes(tick);
    assert.equal(result.sent, 0);
    assert.ok(result.awaitingApproval >= 2);
    assert.equal(sms.sent.length, 0);

    // Approval is stored per business.
    await growth.upsertOrgSettings(orgA, {
      quoteFollowUpApprovedAt: new Date().toISOString(),
    });
    assert.ok((await growth.getOrgSettings(orgA)).quoteFollowUpApprovedAt);
    assert.equal((await growth.getOrgSettings(orgB)).quoteFollowUpApprovedAt, undefined);

    // The held thread is released on the first tick after approval.
    result = await services.processDueQuotes(tick);
    assert.equal(result.sent, 1, "approved business sends");
    assert.equal(sms.sent.length, 1);
    assert.equal((await stepOf(orgA)).nextStepIndex, 1);
    assert.equal(
      Date.parse((await stepOf(orgA)).nextRunAt!),
      Date.parse(quoteSentAt) + DEFAULT_QUOTE_STEPS_MS[1],
      "the next step is scheduled Day 3 after the quote",
    );
    assert.equal((await stepOf(orgB)).nextStepIndex, 0, "the other business is still held");

    // An unrelated settings edit does not invalidate the approval.
    await growth.upsertOrgSettings(orgA, { notifyEmail: "owner@example.test" });
    assert.ok((await growth.getOrgSettings(orgA)).quoteFollowUpApprovedAt);

    // Withdrawing approval stops the next message and clears the column.
    await growth.upsertOrgSettings(orgA, { quoteFollowUpApprovedAt: undefined });
    const stored = await pool.query(
      `SELECT quote_followup_approved_at AS at FROM tc_org_settings WHERE organization_id = $1`,
      [orgA],
    );
    assert.equal(stored.rows[0]?.at, null);
    await makeDue(orgA);
    result = await services.processDueQuotes(tick);
    assert.equal(result.sent, 0);
    assert.equal(sms.sent.length, 1, "nothing sent after withdrawal");

    // Re-approving resumes from the held step and finishes the sequence.
    await growth.upsertOrgSettings(orgA, {
      quoteFollowUpApprovedAt: new Date().toISOString(),
    });
    for (let step = 1; step < DEFAULT_QUOTE_STEPS_MS.length; step += 1) {
      await makeDue(orgA);
      result = await services.processDueQuotes(tick);
      assert.equal(result.sent, 1, `step ${step} sent`);
    }
    const done = await stepOf(orgA);
    assert.equal(done.status, "stopped");
    assert.equal(done.stopReason, "sequence_complete");
    assert.equal(sms.sent.length, DEFAULT_QUOTE_STEPS_MS.length);
    // The held business never received anything.
    assert.equal(sms.sent.some((m) => m.toE164 === "+15145550102"), false);
  });
});
