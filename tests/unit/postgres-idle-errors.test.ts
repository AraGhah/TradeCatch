import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { Pool, Client } from "pg";
import {
  createPostgresPool,
  withPostgresRequestScope,
} from "../../src/lib/postgres-pool";

const socketMarker = Object.getOwnPropertyDescriptor(
  globalThis,
  "WebSocketPair",
);
afterEach(() => {
  mock.restoreAll();
  if (socketMarker)
    Object.defineProperty(globalThis, "WebSocketPair", socketMarker);
  else Reflect.deleteProperty(globalThis, "WebSocketPair");
});
const options = {
  connectionString: "postgres://postgres:password@localhost:1/not-used-by-test",
};
const failure = () =>
  Object.assign(
    Error(
      "postgres://operator:fake-sensitive-password@private-host Bearer fake-sensitive-token",
    ),
    { code: "ECONNRESET" },
  );

test("Node pool idle errors are handled and logged without credentials or driver messages", async () => {
  const lines: string[] = [];
  mock.method(console, "error", (line: string) => {
    lines.push(line);
  });
  const pool = createPostgresPool(options);
  try {
    assert.doesNotThrow(() => pool.emit("error", failure()));
    assert.doesNotThrow(() =>
      pool.emit(
        "error",
        Object.assign(Error("private"), { code: "sensitive-token" }),
      ),
    );
    assert.deepEqual(
      lines.map((line) => JSON.parse(line)),
      [
        { event: "tradecatch.postgres.idle_error", code: "ECONNRESET" },
        { event: "tradecatch.postgres.idle_error", code: "UNKNOWN" },
      ],
    );
    assert.doesNotMatch(
      lines.join(""),
      /sensitive|operator|postgres:\/\/|private-host|Bearer/,
    );
  } finally {
    await pool.end();
  }
});
test("every Worker pool path handles idle errors while retaining invocation isolation and cleanup", async () => {
  Object.defineProperty(globalThis, "WebSocketPair", {
    value: class {},
    configurable: true,
  });
  const seen: Pool[] = [];
  const ended: Pool[] = [];
  const logs: string[] = [];
  mock.method(console, "error", (line: string) => {
    logs.push(line);
  });
  function check(pool: Pool) {
    seen.push(pool);
    assert.equal(pool.listenerCount("error"), 1);
    assert.doesNotThrow(() =>
      pool.emit(
        "error",
        Object.assign(Error("private driver detail"), { code: "28P01" }),
      ),
    );
  }
  mock.method(Pool.prototype, "query", async function (this: Pool) {
    check(this);
    return {
      command: "SELECT",
      rowCount: 1,
      oid: 0,
      rows: [{ ok: 1 }],
      fields: [],
    };
  });
  mock.method(Pool.prototype, "connect", async function (this: Pool) {
    check(this);
    return Object.assign(new Client(), { release() {} });
  });
  mock.method(Pool.prototype, "end", async function (this: Pool) {
    ended.push(this);
  });
  const pool = createPostgresPool(options);
  await withPostgresRequestScope(async () => {
    await pool.query("SELECT 1");
    await withPostgresRequestScope(async () => {
      await pool.query("SELECT 1");
    });
    const client = await pool.connect();
    client.release();
  });
  assert.equal(new Set(seen).size, 1);
  assert.equal(ended.length, 1);
  await pool.query("SELECT 1");
  const client = await pool.connect();
  client.release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(new Set(seen).size, 3);
  assert.equal(new Set(ended).size, 3);
  const before = seen.length;
  await Promise.all([
    withPostgresRequestScope(() => pool.query("SELECT 1")),
    withPostgresRequestScope(() => pool.query("SELECT 1")),
  ]);
  assert.notEqual(seen[before], seen[before + 1]);
  assert.equal(new Set(ended).size, 5);
  assert.equal(logs.length, seen.length);
  assert.doesNotMatch(logs.join(""), /private driver detail/);
  await pool.end();
});
test("active query rejection remains visible and still closes a Worker invocation", async () => {
  Object.defineProperty(globalThis, "WebSocketPair", {
    value: class {},
    configurable: true,
  });
  const expected = failure();
  let ended = 0;
  mock.method(Pool.prototype, "query", async () => {
    throw expected;
  });
  mock.method(Pool.prototype, "end", async () => {
    ended++;
  });
  const pool = createPostgresPool(options);
  await assert.rejects(
    withPostgresRequestScope(() => pool.query("SELECT 1")),
    (error) => error === expected,
  );
  assert.equal(ended, 1);
  await pool.end();
});
