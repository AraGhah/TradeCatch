import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { Client } from "pg";

const exec = promisify(execFile);
const source = process.env.BACKUP_SNAPSHOT_TEST_DATABASE_URL;
it(
  "restores the backup snapshot despite subsequent source writes and rejects mismatched evidence",
  { skip: !source },
  async () => {
    const u = new URL(source!);
    assert.equal(u.hostname, "127.0.0.1");
    assert.equal(u.pathname, "/p0_backup_test_source");
    const target = new URL(u);
    target.pathname = "/p0_backup_test_restore";
    const db = new Client({ connectionString: source });
    await db.connect();
    try {
      for (const name of [
        "mc_workflows",
        "mc_outbound_messages",
        "tc_organizations",
        "tc_quote_threads",
        "tc_appointments",
        "tc_crm_dlq",
        "mc_schema_migrations",
      ])
        await db.query(`CREATE TABLE ${name} (id text PRIMARY KEY)`);
      await db.query("INSERT INTO mc_workflows VALUES ('before-backup')");
      const out = mkdtempSync(join(tmpdir(), "tradecatch-backup-test-"));
      const env = {
        ...process.env,
        BACKUP_DATABASE_URL: source,
        RESTORE_TEST_DATABASE_URL: target.toString(),
      };
      await exec(process.execPath, ["scripts/db-backup.js", "--out", out], {
        env,
      });
      const dump = join(
        out,
        readdirSync(out).find((f) => f.endsWith(".dump"))!,
      );
      const manifest = JSON.parse(
        readFileSync(`${dump}.manifest.json`, "utf8"),
      );
      assert.equal(manifest.retention, "indefinite");
      assert.equal(manifest.fingerprint.rows.mc_workflows.count, 1);
      await db.query("INSERT INTO mc_workflows VALUES ('after-backup')");
      const result = await exec(
        process.execPath,
        ["scripts/db-restore-drill.js", "--dump", dump],
        { env },
      );
      assert.match(result.stdout, /compare\s+OK \(backup snapshot manifest/);
      const restored = new Client({ connectionString: target.toString() });
      await restored.connect();
      try {
        assert.deepEqual(
          (await restored.query("SELECT id FROM mc_workflows")).rows,
          [{ id: "before-backup" }],
        );
      } finally {
        await restored.end();
      }
      manifest.dumpSha256 = "0".repeat(64);
      writeFileSync(`${dump}.manifest.json`, JSON.stringify(manifest));
      await assert.rejects(
        () =>
          exec(
            process.execPath,
            ["scripts/db-restore-drill.js", "--dump", dump],
            { env },
          ),
        (err: unknown) =>
          String((err as { stderr: string }).stderr).includes(
            "manifest does not match",
          ),
      );
    } finally {
      await db.end();
    }
  },
);
