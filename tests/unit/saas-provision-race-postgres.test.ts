/**
 * Provisioning two businesses with the same name at the same moment must give each its
 * own slug, not a 500. The slug is chosen by "first free name" and then inserted, so
 * without serialization two requests pick the same one and the second insert violates
 * `tc_organizations_slug_key`. Needs a disposable database named *_staging with the
 * schema applied (npm run db:schema), given as SAAS_PROVISION_TEST_DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { createPostgresSaasStore } from "../../src/product/saas/postgres-store";

const url = process.env.SAAS_PROVISION_TEST_DATABASE_URL?.trim();
const disposable = url ? /_staging$/.test(new URL(url).pathname) : false;

describe("organization provisioning (real PostgreSQL)", { skip: !url }, () => {
  const suffix = randomBytes(4).toString("hex");
  let pool: Pool;

  before(() => {
    assert.ok(disposable, "Refusing to touch a database not named *_staging");
    pool = new Pool({ connectionString: url, max: 2 });
  });

  after(async () => {
    if (pool) {
      await pool.query(`DELETE FROM tc_organizations WHERE slug LIKE $1`, [
        `race-${suffix}%`,
      ]);
      await pool.query(`DELETE FROM tc_users WHERE email LIKE $1`, [
        `race-${suffix}-%@example.invalid`,
      ]);
      await pool.end();
    }
  });

  it("gives every simultaneous same-name business its own slug", async () => {
    const store = createPostgresSaasStore(url!);
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        store.createOrganizationWithOwner({
          name: `Race ${suffix}`,
          ownerEmail: `race-${suffix}-${i}@example.invalid`,
          ownerName: "Race Owner",
          plan: "essential",
        }),
      ),
    );
    const failures = results.filter((r) => r.status === "rejected");
    assert.deepEqual(
      failures.map((f) => String((f as PromiseRejectedResult).reason)),
      [],
      "no provisioning request may fail",
    );
    const slugs = results.map(
      (r) =>
        (r as PromiseFulfilledResult<{ organization: { slug: string } }>).value
          .organization.slug,
    );
    assert.equal(new Set(slugs).size, 12, "twelve distinct slugs");
    for (const slug of slugs)
      assert.match(slug, new RegExp(`^race-${suffix}(-\\d+)?$`));
  });
});
