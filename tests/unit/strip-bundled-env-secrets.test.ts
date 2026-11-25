import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  isSecretKey,
  stripSecretKeys,
  stripBundledEnvSecrets,
  stripBundledEnvFile,
} = require("../../scripts/strip-bundled-env-secrets.js");

const SAMPLE = [
  'export const production = {"DATABASE_URL":"postgres://app:StalePassword123@db.example.supabase.co:5432/postgres","NEXT_PUBLIC_SITE_URL":"https://tradecatch.ca","TRADECATCH_ENV":"production","AUTH_SECRET":"abcdefghijklmnopqrstuvwxyz012345","MISSED_CALL_DURABLE_STORE":"1"};', // secret-scan: allow
  'export const development = {"OPENAI_API_KEY":"sk-test-not-for-production-xxxxxxxxxxxx","NEXT_PUBLIC_DEMO_MODE":"1"};',
  "export const test = {};",
  "",
].join("\n");

test("secret key matcher keeps public and non-credential settings", () => {
  assert.equal(isSecretKey("DATABASE_URL"), true);
  assert.equal(isSecretKey("AUTH_SECRET"), true);
  assert.equal(isSecretKey("STRIPE_SECRET_KEY"), true);
  assert.equal(isSecretKey("TWILIO_AUTH_TOKEN"), true);
  assert.equal(isSecretKey("INSTALLATION_CREDENTIAL"), true);
  assert.equal(isSecretKey("NEXT_PUBLIC_SITE_URL"), false);
  assert.equal(isSecretKey("MISSED_CALL_DURABLE_STORE"), false);
  assert.equal(isSecretKey("TRADECATCH_ENV"), false);
});

test("stripSecretKeys drops credentials and keeps safe values", () => {
  const { cleaned, removed } = stripSecretKeys({
    DATABASE_URL: "postgres://app:secret@host/db",
    NEXT_PUBLIC_SITE_URL: "https://tradecatch.ca",
    AUTH_SECRET: "abcdefghijklmnopqrstuvwxyz012345", // secret-scan: allow
    MISSED_CALL_DURABLE_STORE: "1",
  });
  assert.equal(removed, 2);
  assert.deepEqual(cleaned, {
    NEXT_PUBLIC_SITE_URL: "https://tradecatch.ca",
    MISSED_CALL_DURABLE_STORE: "1",
  });
});

test("stripBundledEnvSecrets removes DATABASE_URL fallback that caused 28P01", () => {
  const { source, removed } = stripBundledEnvSecrets(SAMPLE);
  assert.ok(removed >= 3);
  assert.match(source, /export const production = \{/);
  assert.doesNotMatch(source, /DATABASE_URL/);
  assert.doesNotMatch(source, /AUTH_SECRET/);
  assert.doesNotMatch(source, /OPENAI_API_KEY/);
  assert.doesNotMatch(source, /StalePassword123/);
  assert.match(source, /NEXT_PUBLIC_SITE_URL":"https:\/\/tradecatch.ca"/);
  assert.match(source, /MISSED_CALL_DURABLE_STORE":"1"/);
  assert.match(source, /NEXT_PUBLIC_DEMO_MODE":"1"/);
  assert.match(source, /export const test = \{\};/);
});

test("reports the names, never the values, of production credentials it removed", () => {
  const { removedKeys } = stripBundledEnvSecrets(
    [
      'export const production = {"DATABASE_URL":"postgres://app:StalePassword123@db.example.supabase.co:5432/postgres","STRIPE_SECRET_KEY":"","CRON_SECRET":"  ","AUTH_SECRET":"abcdefghijklmnopqrstuvwxyz012345","TRADECATCH_ENV":"production"};', // secret-scan: allow
      'export const development = {"OPENAI_API_KEY":"sk-test-not-for-production-xxxxxxxxxxxx"};',
      "export const test = {};",
      "",
    ].join("\n"),
  );
  // Only production is what the Worker reads; empty values were never a credential.
  assert.deepEqual(removedKeys, ["DATABASE_URL", "AUTH_SECRET"]);
  assert.doesNotMatch(JSON.stringify(removedKeys), /StalePassword123|abcdefgh/);
});

test("stripBundledEnvSecrets refuses a remaining database URL with a password", () => {
  // Key name deliberately avoids SECRET/TOKEN/PASSWORD so only the URL shape
  // triggers the fail-closed scan after key stripping.
  const smuggled = [
    'export const production = {"LEGACY_DB_DSN":"postgres://app:RealPassword999999@db.example.supabase.co:5432/postgres"};', // secret-scan: allow
    "export const development = {};",
    "export const test = {};",
    "",
  ].join("\n");
  assert.throws(
    () => stripBundledEnvSecrets(smuggled),
    /database URL with a password remains/,
  );
});

test("stripBundledEnvSecrets requires all three OpenNext mode exports", () => {
  assert.throws(
    () => stripBundledEnvSecrets('export const production = {};\n'),
    /expected production, development and test/,
  );
});

test("stripBundledEnvFile rewrites on disk without printing secret values", () => {
  // The script resolves its argument, which on Windows prefixes a drive letter.
  const target = path.resolve("/tmp/next-env.mjs");
  const files = new Map([[target, SAMPLE]]);
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    const result = stripBundledEnvFile("/tmp/next-env.mjs", {
      readFile: (filePath: string) => {
        const text = files.get(filePath);
        if (text === undefined) throw new Error("missing");
        return text;
      },
      writeFile: (filePath: string, contents: string) => {
        files.set(filePath, contents);
      },
    });
    assert.ok(result.removed >= 3);
    const written = files.get(target)!;
    assert.doesNotMatch(written, /DATABASE_URL|StalePassword123|AUTH_SECRET/);
    assert.match(logs.join("\n"), /Removed \d+ secret key/);
    assert.doesNotMatch(logs.join("\n"), /StalePassword123/);
  } finally {
    console.log = originalLog;
  }
});

test("stripBundledEnvFile fails closed when the OpenNext module is missing", () => {
  assert.throws(
    () =>
      stripBundledEnvFile("missing-next-env.mjs", {
        readFile: () => {
          throw new Error("ENOENT");
        },
        writeFile: () => {
          throw new Error("should not write");
        },
      }),
    /missing OpenNext env module/,
  );
});
