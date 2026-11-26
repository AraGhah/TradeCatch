/**
 * Why the database failed, in a form that is safe to log and to email
 * (2026-11-24 outage follow-up): the alert must tell an authentication refusal
 * from a timeout or a missing setting, without ever quoting the driver message.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { databaseFailureCode } from "../../src/lib/postgres-pool";
import { describeDatabaseFailure } from "../../src/product/reliability/alerts";
import { probeDatabase } from "../../src/product/reliability/collectors";
import { assertAlertSafe } from "../../src/product/reliability/sanitize";
import { DEFAULT_THRESHOLDS as T } from "../../src/product/reliability/thresholds";

type Queryable = Parameters<typeof probeDatabase>[0];

describe("databaseFailureCode", () => {
  it("keeps a SQLSTATE or a known network code", () => {
    assert.equal(databaseFailureCode(Object.assign(new Error("x"), { code: "28P01" })), "28P01");
    assert.equal(databaseFailureCode(Object.assign(new Error("x"), { code: "ECONNREFUSED" })), "ECONNREFUSED");
  });

  it("reads the SQLSTATE of a pg server error, whose name is always just \"error\"", () => {
    // pg-protocol's DatabaseError: name "error" for every server-side failure.
    const missingTable = Object.assign(new Error('relation "tc_privacy_settings" does not exist'), {
      name: "error",
      code: "42P01",
    });
    assert.equal(databaseFailureCode(missingTable), "42P01");
  });

  it("finds the code inside an AggregateError (Node's multi-address connect)", () => {
    const inner = Object.assign(new Error("connect ETIMEDOUT 10.0.0.1:5432"), { code: "ETIMEDOUT" });
    assert.equal(databaseFailureCode(new AggregateError([inner], "")), "ETIMEDOUT");
  });

  it("names the fixed, uncoded pg and pg-pool failures", () => {
    for (const [message, code] of [
      ["Connection terminated due to connection timeout", "CONNECT_TIMEOUT"],
      ["timeout exceeded when trying to connect", "CONNECT_TIMEOUT"],
      ["Connection terminated unexpectedly", "CONNECTION_CLOSED"],
      ["database check timed out", "QUERY_TIMEOUT"],
    ])
      assert.equal(databaseFailureCode(new Error(message)), code, message);
  });

  it("never turns an arbitrary message or code into output", () => {
    assert.equal(databaseFailureCode(new Error("connect to postgres://u:hunter2@db.internal failed")), "UNKNOWN"); // secret-scan: allow
    assert.equal(databaseFailureCode(Object.assign(new Error("x"), { code: "postgres://u:p@h" })), "UNKNOWN"); // secret-scan: allow
    assert.equal(databaseFailureCode(null), "UNKNOWN");
    assert.equal(databaseFailureCode("boom"), "UNKNOWN");
  });
});

describe("describeDatabaseFailure", () => {
  it("explains the causes that need different fixes, and stays alert-safe", () => {
    assert.match(describeDatabaseFailure("28P01"), /refused the login/);
    assert.match(describeDatabaseFailure("NOT_CONFIGURED"), /DATABASE_URL is not set/);
    assert.match(describeDatabaseFailure("CONNECT_TIMEOUT"), /did not answer in time/);
    assert.match(describeDatabaseFailure("53300"), /no free connections/);
    assert.match(describeDatabaseFailure("57P03"), /restarting or paused/);
    assert.match(describeDatabaseFailure("XX000"), /connection pooler/);
    assert.match(describeDatabaseFailure(undefined), /No error code/);
    for (const code of ["28P01", "NOT_CONFIGURED", "CONNECT_TIMEOUT", "ENOTFOUND", "25006", "UNKNOWN"])
      assert.doesNotThrow(() => assertAlertSafe(describeDatabaseFailure(code)), code);
  });
});

describe("probeDatabase failure code", () => {
  const fast = { ...T, database: { ...T.database, probeTimeoutMs: 15, probeAttempts: 2 } };

  it("reports the code of its last failed attempt", async () => {
    const refused = {
      query: async () => Promise.reject(Object.assign(new Error("password authentication failed"), { code: "28P01" })),
    } as unknown as Queryable;
    const probe = await probeDatabase(refused, fast);
    assert.equal(probe.ok, false);
    assert.equal(probe.failureCode, "28P01");
  });

  it("calls a query that never answers a timeout", async () => {
    const hung = { query: () => new Promise(() => undefined) } as unknown as Queryable;
    assert.equal((await probeDatabase(hung, fast)).failureCode, "QUERY_TIMEOUT");
  });

  it("has no failure code when the database works", async () => {
    const ok = { query: async () => ({ rows: [] }) } as unknown as Queryable;
    const probe = await probeDatabase(ok, fast);
    assert.equal(probe.ok, true);
    assert.equal(probe.failureCode, undefined);
  });
});
