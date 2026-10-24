import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  requireDatabaseSecret,
  requireSchedulerSecret,
  checkWorkerDatabase,
} = require("../../scripts/check-worker-database.js");
const bindings = [
  { name: "DATABASE_URL", type: "secret_text" },
  { name: "MISSED_CALL_OPS_SECRET", type: "secret_text" },
];

test("release requires a shared scheduler credential, not merely notification credentials", () => {
  for (const name of ["MISSED_CALL_OPS_SECRET", "CRON_SECRET"]) {
    assert.doesNotThrow(() =>
      requireSchedulerSecret([{ name, type: "secret_text" }]),
    );
    assert.throws(
      () => requireSchedulerSecret([{ name, type: "plain_text" }]),
      /Release blocked/,
    );
  }
  for (const invalid of [
    undefined,
    {},
    [],
    [null],
    [{ name: "DATABASE_URL", type: "secret_text" }],
    [
      "BOOK_AUDIT_RETRY_SECRET",
      "NOTIFICATION_RETRY_SECRET",
      "GMAIL_SYNC_SECRET",
      "MONITORING_SECRET",
    ].map((name) => ({ name, type: "secret_text" })),
  ])
    assert.throws(() => requireSchedulerSecret(invalid), /Release blocked/);
});

test("database release guard requires exactly one encrypted runtime database secret", () => {
  assert.doesNotThrow(() => requireDatabaseSecret(bindings));
  for (const invalid of [
    undefined,
    {},
    [],
    [null],
    [{ name: "OTHER_SECRET", type: "secret_text" }],
    [{ name: "DATABASE_URL", type: "plain_text" }],
    [{ name: "DATABASE_URL" }],
    [...bindings, ...bindings],
  ]) {
    assert.throws(() => requireDatabaseSecret(invalid), /Release blocked/);
  }
});

test("database release guard checks the explicit production or staging Worker with metadata only", () => {
  for (const staging of [false, true]) {
    let calls = 0;
    checkWorkerDatabase({
      staging,
      run: (file: string, args: string[], options: Record<string, unknown>) => {
        calls++;
        assert.equal(file, process.execPath);
        assert.match(args[0], /wrangler[\\/]bin[\\/]wrangler\.js$/);
        assert.deepEqual(args.slice(1, 3), ["secret", "list"]);
        assert.equal(
          args[args.indexOf("--name") + 1],
          staging ? "tradecatch-staging" : "tradecatch",
        );
        assert.equal(args.includes("--env"), staging);
        if (staging) assert.equal(args[args.indexOf("--env") + 1], "staging");
        assert.equal(args[args.indexOf("--format") + 1], "json");
        assert.match(
          args[args.indexOf("--env-file") + 1],
          /scripts[\\/]wrangler-types\.env$/,
        );
        assert.equal(options.timeout, 30_000);
        assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
        return JSON.stringify(bindings);
      },
    });
    assert.equal(calls, 1);
  }
});

test("database release guard fails closed on missing Workers, auth/network errors and malformed output", () => {
  for (const run of [
    () => {
      throw new Error("sensitive provider response");
    },
    () => "sensitive provider response",
    () => JSON.stringify({ result: bindings }),
    () => "[]",
  ]) {
    assert.throws(
      () => checkWorkerDatabase({ run }),
      (error: Error) =>
        /Release blocked/.test(error.message) &&
        !error.message.includes("sensitive provider response"),
    );
  }
});
