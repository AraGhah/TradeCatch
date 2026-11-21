/**
 * KAN-27 against a REAL PostgreSQL server: the SQL behind "one live link" and
 * "the link, the password and the sessions change together or not at all".
 *
 * Needs a throwaway local database (never a shared one):
 *   docker run --rm -d --name tc-kan27-pg -e POSTGRES_PASSWORD=pw -p 127.0.0.1:54327:5432 postgres:16-alpine
 *   PASSWORD_RESET_TEST_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:54327/postgres npm run test:unit
 * The test applies the real schema files itself. It refuses any host that is
 * not the local machine.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { hashToken, newId, randomToken } from "../../src/product/saas/ids";
import { createPostgresSaasStore } from "../../src/product/saas/postgres-store";
import type { SaasStore } from "../../src/product/saas/store";
import { describePasswordTokenContract } from "./support/password-token-contract";

const url = process.env.PASSWORD_RESET_TEST_DATABASE_URL?.trim();
const local = url
  ? ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)
  : false;

const schema = (...parts: string[]) =>
  readFileSync(path.join(process.cwd(), "src", "product", ...parts), "utf8");

describe("password links on real PostgreSQL", { skip: !url }, () => {
  let pool: Pool;
  let store: SaasStore;
  const suffix = randomToken(4).replace(/[^a-z0-9]/gi, "x").toLowerCase();

  before(async () => {
    assert.ok(local, "refusing to run against a database that is not on this machine");
    pool = new Pool({ connectionString: url, max: 12 });
    // Just enough to host the tables under test: the real SaaS, password and
    // session files, with a stand-in for the one foreign table they mention.
    await pool.query(`CREATE TABLE IF NOT EXISTS mc_clients (id TEXT PRIMARY KEY)`);
    await pool.query(
      `CREATE TABLE IF NOT EXISTS mc_schema_migrations (
         id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
    await pool.query(schema("saas", "schema.sql"));
    await pool.query(schema("saas", "password-auth.sql"));
    await pool.query(schema("saas", "auth-sessions.sql"));
    store = createPostgresSaasStore(url!);
  });

  after(async () => {
    if (pool) {
      await pool.query(`DELETE FROM tc_users WHERE email LIKE $1`, [`kan27-${suffix}-%`]);
      await pool.query(`DELETE FROM tc_organizations WHERE slug LIKE $1`, [`kan27-${suffix}-%`]);
      await pool.end();
    }
  });

  let counter = 0;
  async function newUser() {
    counter += 1;
    const userId = newId("usr");
    const organizationId = newId("org");
    await pool.query(
      `INSERT INTO tc_organizations (id, name, slug) VALUES ($1, $2, $3)`,
      [organizationId, `Org ${counter}`, `kan27-${suffix}-${counter}`],
    );
    await pool.query(
      `INSERT INTO tc_users (id, email, name) VALUES ($1, $2, 'Owner')`,
      [userId, `kan27-${suffix}-${counter}@example.test`],
    );
    return { userId, organizationId };
  }

  describePasswordTokenContract("the shared storage contract", async () => ({
    store,
    newUser,
  }));

  describe("PostgreSQL specifics", () => {
    it("only the SHA-256 of a link is stored, never the link", async () => {
      const { userId } = await newUser();
      const raw = randomToken(32);
      await store.replacePasswordToken({
        id: newId("pwt"),
        userId,
        tokenHash: hashToken(raw),
        kind: "reset",
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        createdAt: new Date().toISOString(),
      });
      const { rows } = await pool.query(
        `SELECT t::text AS row FROM tc_password_tokens t WHERE user_id = $1`,
        [userId],
      );
      assert.equal(rows.length, 1);
      assert.equal(String(rows[0].row).includes(raw), false, "the raw link is nowhere in the row");
      assert.equal(String(rows[0].row).includes(hashToken(raw)), true);
    });

    it("a failure half way rolls the whole step back: link unspent, password unset, sessions alive", async () => {
      const { userId, organizationId } = await newUser();
      const sessionId = newId("ses");
      await store.createSession({
        id: sessionId,
        userId,
        organizationId,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        createdAt: new Date().toISOString(),
      });
      const raw = randomToken(32);
      await store.replacePasswordToken({
        id: newId("pwt"),
        userId,
        tokenHash: hashToken(raw),
        kind: "reset",
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        createdAt: new Date().toISOString(),
      });

      // password_hash is NOT NULL: the link is spent first inside the step, then
      // this insert fails. Nothing may survive.
      await assert.rejects(
        store.completePasswordReset({
          tokenHash: hashToken(raw),
          atIso: new Date().toISOString(),
          passwordHash: null as unknown as string,
        }),
      );
      const link = await store.findPasswordToken(hashToken(raw));
      assert.equal(link?.consumedAt, undefined, "the link was not spent");
      assert.equal(await store.getPasswordCredential(userId), null);
      assert.equal((await store.getSession(sessionId))?.revokedAt, undefined);

      // So the person can simply try again.
      assert.ok(
        await store.completePasswordReset({
          tokenHash: hashToken(raw),
          atIso: new Date().toISOString(),
          passwordHash: "scrypt$retry$hash",
        }),
      );
    });

    it("issuing links while others finish never leaves two live links or a half-finished reset", async () => {
      const { userId, organizationId } = await newUser();
      for (let round = 0; round < 5; round += 1) {
        const sessionId = newId("ses");
        await store.createSession({
          id: sessionId,
          userId,
          organizationId,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          createdAt: new Date().toISOString(),
        });
        const base = randomToken(32);
        await store.replacePasswordToken({
          id: newId("pwt"),
          userId,
          tokenHash: hashToken(base),
          kind: "reset",
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          createdAt: new Date().toISOString(),
        });
        const issuers = Array.from({ length: 6 }, () => randomToken(32));
        const results = await Promise.all([
          ...issuers.map((raw) =>
            store.replacePasswordToken({
              id: newId("pwt"),
              userId,
              tokenHash: hashToken(raw),
              kind: "reset",
              expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
              createdAt: new Date().toISOString(),
            }),
          ),
          ...Array.from({ length: 4 }, (_, i) =>
            store.completePasswordReset({
              tokenHash: hashToken(base),
              atIso: new Date().toISOString(),
              passwordHash: `scrypt$mix$${round}-${i}`,
            }),
          ),
        ]);
        const finished = results.slice(6).filter(Boolean).length;
        assert.ok(finished <= 1, "never two winners");

        const { rows } = await pool.query(
          `SELECT count(*)::int AS open FROM tc_password_tokens
           WHERE user_id = $1 AND kind = 'reset' AND consumed_at IS NULL`,
          [userId],
        );
        // Whether the reset won or an issuer did, a finished reset cancels every
        // other link; otherwise exactly one issuer's link is the live one.
        assert.ok(rows[0].open <= 1, `at most one live link, saw ${rows[0].open}`);
        if (finished === 1) {
          assert.ok((await store.getSession(sessionId))?.revokedAt, "a finished reset signed the session out");
        }
      }
    });
  });
});
