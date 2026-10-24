import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, before, after } from "node:test";
import { Pool } from "pg";
import { InstallationRegistry } from "../../src/product/installations/registry";

const url = process.env.INSTALLATION_TEST_DATABASE_URL;
describe(
  "installation approvals in isolated PostgreSQL",
  { skip: !url },
  () => {
    let admin: Pool;
    let pool: Pool;
    let registry: InstallationRegistry;
    const schema =
      "installation_test_" + crypto.randomUUID().replaceAll("-", "");
    before(async () => {
      const target = new URL(url!);
      assert.ok(
        ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname),
        "Local disposable PostgreSQL required",
      );
      assert.match(
        target.pathname,
        /^\/tc\d+_staging$/,
        "Explicit test database required",
      );
      admin = new Pool({ connectionString: url });
      await admin.query(`CREATE SCHEMA ${schema}`);
      pool = new Pool({
        connectionString: url,
        options: `-c search_path=${schema}`,
      });
      await pool.query(
        readFileSync("src/product/installations/schema.sql", "utf8"),
      );
      // Reapplying migration must be additive and must not grant approvals.
      await pool.query(
        readFileSync("src/product/installations/schema.sql", "utf8"),
      );
      registry = new InstallationRegistry(pool);
    });
    after(async () => {
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.end();
      }
    });
    const register = async () => {
      const origin = `https://${crypto.randomUUID()}.example.test`;
      const receipt = await registry.command(
        {
          action: "register",
          label: "Fictional installation",
          origin,
          reason: "Explicit isolated test",
        },
        "admin_fixture",
      );
      return { origin, ...receipt };
    };
    it("starts pending, hashes credentials and never exposes hashes in the admin list", async () => {
      const item = await register();
      assert.equal(
        await registry.verify(
          item.installationId,
          item.credential!,
          item.origin,
        ),
        false,
      );
      const stored = await pool.query(
        "SELECT credential_hash FROM tc_installations WHERE id=$1",
        [item.installationId],
      );
      assert.equal(stored.rows[0].credential_hash.length, 64);
      assert.notEqual(stored.rows[0].credential_hash, item.credential);
      assert.doesNotMatch(
        JSON.stringify(await registry.list()),
        /credential_hash|credential/,
      );
    });
    it("approves once, isolates domains/installations and immediately revokes", async () => {
      const item = await register();
      await registry.command(
        {
          action: "decide",
          domainId: item.domainId,
          status: "approved",
          revision: 0,
          reason: "Ownership verified in fixture",
        },
        "reviewer_fixture",
      );
      for (let deploy = 0; deploy < 3; deploy++)
        assert.equal(
          await registry.verify(
            item.installationId,
            item.credential!,
            item.origin,
          ),
          true,
        );
      assert.equal(
        await registry.verify(
          crypto.randomUUID(),
          item.credential!,
          item.origin,
        ),
        false,
      );
      assert.equal(
        await registry.verify(item.installationId, "b".repeat(43), item.origin),
        false,
      );
      assert.equal(
        await registry.verify(
          item.installationId,
          item.credential!,
          "https://new.example.test",
        ),
        false,
      );
      const audit = await pool.query(
        "SELECT actor,from_status,to_status FROM tc_installation_audit WHERE domain_id=$1 ORDER BY created_at",
        [item.domainId],
      );
      assert.equal(audit.rows.length, 2);
      assert.equal(audit.rows[1].actor, "reviewer_fixture");
      await registry.command(
        {
          action: "decide",
          domainId: item.domainId,
          status: "revoked",
          revision: 1,
          reason: "Revocation test",
        },
        "reviewer_fixture",
      );
      assert.equal(
        await registry.verify(
          item.installationId,
          item.credential!,
          item.origin,
        ),
        false,
      );
      await assert.rejects(
        registry.command(
          {
            action: "decide",
            domainId: item.domainId,
            status: "approved",
            revision: 1,
            reason: "Stale approval test",
          },
          "reviewer_fixture",
        ),
      );
    });
    it("does not approve another origin under an existing preview wildcard", async () => {
      const item = await register();
      const extra = await registry.command(
        {
          action: "add_domain",
          installationId: item.installationId,
          origin: `https://${crypto.randomUUID()}-tradecatch.ara-ghahramanyan07.workers.dev`,
          reason: "Exact preview inventory",
        },
        "admin_fixture",
      );
      await registry.command(
        {
          action: "decide",
          domainId: extra.domainId,
          status: "rejected",
          revision: 0,
          reason: "Not an authorized preview",
        },
        "reviewer_fixture",
      );
      const list = await registry.list();
      assert.equal(
        list.domains.find((d) => d.id === extra.domainId)?.status,
        "rejected",
      );
      await assert.rejects(
        registry.command(
          {
            action: "add_domain",
            installationId: item.installationId,
            origin: item.origin,
            reason: "Duplicate origin test",
          },
          "admin_fixture",
        ),
      );
    });
    it("serializes concurrent decisions and commits exactly one audit result", async () => {
      const item = await register();
      const decide = (status: "approved" | "rejected") =>
        registry.command(
          {
            action: "decide",
            domainId: item.domainId,
            status,
            revision: 0,
            reason: "Concurrent review test",
          },
          "reviewer_fixture",
        );
      const results = await Promise.allSettled([
        decide("approved"),
        decide("rejected"),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM tc_installation_audit WHERE domain_id=$1",
            [item.domainId],
          )
        ).rows[0].n,
        2,
      );
    });
    it("revokes all aliases atomically and invalidates stale pending approvals", async () => {
      const item = await register();
      await registry.command(
        {
          action: "decide",
          domainId: item.domainId,
          status: "approved",
          revision: 0,
          reason: "Approved fixture",
        },
        "reviewer_fixture",
      );
      const alias = `https://${crypto.randomUUID()}.example.test`;
      const added = await registry.command(
        {
          action: "add_domain",
          installationId: item.installationId,
          origin: alias,
          reason: "Pending alias fixture",
        },
        "admin_fixture",
      );
      await registry.command(
        {
          action: "revoke_installation",
          installationId: item.installationId,
          reason: "Whole installation revoked",
        },
        "reviewer_fixture",
      );
      assert.equal(
        await registry.verify(
          item.installationId,
          item.credential!,
          item.origin,
        ),
        false,
      );
      assert.equal(
        await registry.verify(item.installationId, item.credential!, alias),
        false,
      );
      await assert.rejects(
        registry.command(
          {
            action: "decide",
            domainId: added.domainId,
            status: "approved",
            revision: 0,
            reason: "Stale alias approval",
          },
          "reviewer_fixture",
        ),
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM tc_installation_audit WHERE action='revoked' AND domain_id=ANY($1::uuid[])",
            [[item.domainId, added.domainId]],
          )
        ).rows[0].n,
        2,
      );
    });
    it("rolls back status when the required audit insert fails; audit is append-only", async () => {
      const item = await register();
      await pool.query(`CREATE FUNCTION fail_installation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason='force audit failure' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_installation_audit BEFORE INSERT ON tc_installation_audit FOR EACH ROW EXECUTE FUNCTION fail_installation_audit();`);
      await assert.rejects(
        registry.command(
          {
            action: "decide",
            domainId: item.domainId,
            status: "approved",
            revision: 0,
            reason: "force audit failure",
          },
          "reviewer_fixture",
        ),
      );
      assert.equal(
        (
          await pool.query(
            "SELECT status FROM tc_installation_domains WHERE id=$1",
            [item.domainId],
          )
        ).rows[0].status,
        "pending",
      );
      await assert.rejects(
        pool.query("DELETE FROM tc_installation_audit WHERE domain_id=$1", [
          item.domainId,
        ]),
      );
      await assert.rejects(
        pool.query(
          "UPDATE tc_installation_audit SET actor='tampered' WHERE domain_id=$1",
          [item.domainId],
        ),
      );
      await pool.query(
        "DROP TRIGGER fail_installation_audit ON tc_installation_audit",
      );
    });
  },
);
