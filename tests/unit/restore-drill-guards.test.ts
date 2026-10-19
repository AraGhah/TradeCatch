import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const { targetProblem } = createRequire(__filename)("../../scripts/db-restore-drill.js") as {
  targetProblem: (target: string, protectedUrls: Array<string | undefined>, options?: { allowAnyName?: boolean }) => string | null;
};

const LIVE = "postgresql://postgres.abcdefgh:pw@aws-0-ca-central-1.pooler.supabase.com:5432/postgres";
const SOURCE = "postgres://backup:pw@db.internal.example:5432/tradecatch";

describe("restore drill target guard", () => {
  it("accepts a disposable local database", () => {
    assert.equal(targetProblem("postgres://u:p@localhost:55432/tc_restore_drill", [LIVE, SOURCE]), null);
    assert.equal(targetProblem("postgres://u:p@127.0.0.1/scratch", [LIVE, SOURCE]), null);
  });

  it("refuses the live database and the backup source, however the URL is spelled", () => {
    assert.match(targetProblem(LIVE, [LIVE]) ?? "", /same database/);
    assert.match(targetProblem(SOURCE.replace("backup:pw", "other:secret"), [SOURCE]) ?? "", /same database/);
    assert.match(targetProblem(`${LIVE}?sslmode=require`, [LIVE]) ?? "", /same database/);
    assert.match(targetProblem("postgres://u:p@localhost:5432/drill_db", ["postgres://x:y@127.0.0.1:5432/drill_db"]) ?? "", /same database/);
  });

  it("refuses a target whose name does not say it is disposable", () => {
    for (const name of ["postgres", "production", "tradecatch"]) {
      assert.match(targetProblem(`postgres://u:p@localhost/${name}`, []) ?? "", /must contain one of/, name);
    }
    assert.equal(targetProblem("postgres://u:p@localhost/postgres", [], { allowAnyName: true }), null);
  });

  it("ignores protected URLs that are missing or unparsable, and rejects an unparsable target", () => {
    assert.equal(targetProblem("postgres://u:p@localhost/tc_test", [undefined, "", "not a url"]), null);
    assert.match(targetProblem("not a url", []) ?? "", /not a valid database URL/);
  });

  it("does not echo credentials in its reasons", () => {
    const reason = targetProblem("postgres://admin:hunter2@localhost/production", []) ?? "";
    assert.doesNotMatch(reason, /hunter2|admin/);
  });
});
