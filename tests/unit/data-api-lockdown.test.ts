import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..", "..");

function schemaFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return schemaFiles(full);
    return /^schema.*\.sql$/.test(name) ? [full] : [];
  });
}

describe("Data API lockdown covers every table the schemas create", () => {
  const lockdown = readFileSync(join(ROOT, "scripts", "sql", "lockdown-data-api.sql"), "utf8");
  const prefixes = /c\.relname ~ '\^\(([a-z|]+)\)_'/.exec(lockdown)?.[1]?.split("|") ?? [];

  it("reads its table prefixes from the SQL file", () => {
    assert.ok(prefixes.length >= 4, `found prefixes: ${prefixes.join(",")}`);
  });

  it("matches the prefix filter used by the reporting script", () => {
    const script = readFileSync(join(ROOT, "scripts", "lockdown-data-api.js"), "utf8");
    assert.match(script, new RegExp(`\\^\\(${prefixes.join("\\|")}\\)_`));
  });

  it("leaves no schema-created table outside those prefixes", () => {
    const files = schemaFiles(join(ROOT, "src"));
    assert.ok(files.length >= 15, `expected the module schemas, found ${files.length}`);
    const uncovered: string[] = [];
    let parsed = 0;
    for (const file of files) {
      const sql = readFileSync(file, "utf8");
      for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)) {
        const table = match[1]!;
        parsed += 1;
        if (!prefixes.some((prefix) => table.startsWith(`${prefix}_`))) uncovered.push(`${table} (${file})`);
      }
    }
    // Guards against the parser silently matching nothing (a vacuous pass).
    assert.ok(parsed >= 100, `only parsed ${parsed} CREATE TABLE statements`);
    assert.deepEqual(uncovered, [], "a new table prefix must be added to scripts/sql/lockdown-data-api.sql and scripts/lockdown-data-api.js");
  });

  it("never adds a policy that would open a table to the Data API roles", () => {
    for (const file of schemaFiles(join(ROOT, "src"))) {
      const sql = readFileSync(file, "utf8");
      assert.doesNotMatch(sql, /CREATE\s+POLICY[^;]*\bTO\s+(?:anon|authenticated|public)\b/i, file);
      assert.doesNotMatch(sql, /GRANT\s+[^;]*\bTO\s+(?:anon|authenticated)\b/i, file);
    }
  });
});
