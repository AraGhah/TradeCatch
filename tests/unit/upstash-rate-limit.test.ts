import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, it } from "node:test";
import {
  isUpstashConfigured,
  upstashClaimIdempotencyKey,
  upstashTokenBucket,
} from "../../src/lib/upstash";

describe("isUpstashConfigured", () => {
  it("is false when env vars are missing", () => {
    assert.equal(isUpstashConfigured({}), false);
    assert.equal(
      isUpstashConfigured({ UPSTASH_REDIS_REST_URL: "https://example.com" }),
      false,
    );
  });

  it("is true when both URL and token are set", () => {
    assert.equal(
      isUpstashConfigured({
        UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "token",
      }),
      true,
    );
  });
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("upstash helpers without network", () => {
  it("upstashTokenBucket throws when not configured", async () => {
    await assert.rejects(
      () =>
        upstashTokenBucket({
          key: "x",
          spec: { capacity: 1, refillEveryMs: 1000 },
          env: {},
        }),
      /not configured/,
    );
  });

  it("upstashClaimIdempotencyKey throws when not configured", async () => {
    await assert.rejects(
      () => upstashClaimIdempotencyKey({ key: "x", ttlMs: 1000, env: {} }),
      /not configured/,
    );
  });
});

describe("upstashTokenBucket request and reply handling", () => {
  const env = {
    UPSTASH_REDIS_REST_URL: "https://fake.upstash.test",
    UPSTASH_REDIS_REST_TOKEN: "secret-token",
  };

  it("sends one EVAL with the bucket in milliseconds and reads the reply", async () => {
    const seen: Array<{ command: unknown[]; auth: string | null }> = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      seen.push({
        command: JSON.parse(String(init?.body)) as unknown[],
        auth: new Headers(init?.headers).get("authorization"),
      });
      // Allowed; bucket of 20 refilling every 45 s now owes 45 s.
      return new Response(JSON.stringify({ result: [1, "45000.000", 1700000000000] }));
    }) as typeof fetch;

    const result = await upstashTokenBucket({
      key: "auth-password:203.0.113.9",
      spec: { capacity: 20, refillEveryMs: 45_000 },
      env,
    });

    assert.equal(seen.length, 1, "one round trip, so the decision is atomic");
    const [verb, script, keys, key, refill, tolerance, cost] = seen[0].command;
    assert.equal(verb, "EVAL");
    assert.match(String(script), /redis\.call\('TIME'\)/);
    assert.deepEqual([keys, key, refill, tolerance, cost], [1, "tb:auth-password:203.0.113.9", 45_000, 900_000, 45_000]);
    assert.equal(seen[0].auth, "Bearer secret-token");
    assert.deepEqual(result, { allowed: true, remaining: 19, retryAfterMs: 0, resetAfterMs: 45_000 });
  });

  it("turns a refusal into a wait", async () => {
    // Bucket of 2 (30 s each) is 58 s in debt: it needs 28 s to fit one more.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ result: [0, "58000.000", 1] }))) as typeof fetch;
    const result = await upstashTokenBucket({
      key: "k",
      spec: { capacity: 2, refillEveryMs: 30_000 },
      env,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.retryAfterMs, 28_000);
    assert.equal(result.remaining, 0);
  });

  it("rejects replies it cannot read instead of guessing", async () => {
    for (const result of [null, "OK", [1], [1, "not-a-number", 1]]) {
      globalThis.fetch = (async () => new Response(JSON.stringify({ result }))) as typeof fetch;
      await assert.rejects(() =>
        upstashTokenBucket({ key: "k", spec: { capacity: 2, refillEveryMs: 1000 }, env }),
      );
    }
  });

  it("surfaces Redis and HTTP errors so the caller can use the next tier", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "ERR boom" }))) as typeof fetch;
    await assert.rejects(
      () => upstashTokenBucket({ key: "k", spec: { capacity: 2, refillEveryMs: 1000 }, env }),
      /ERR boom/,
    );
    globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
    await assert.rejects(
      () => upstashTokenBucket({ key: "k", spec: { capacity: 2, refillEveryMs: 1000 }, env }),
      /503/,
    );
  });
});

// --- The Lua script itself, on a real Redis -------------------------------
// The tests above cannot run Lua. This part sends the same HTTP requests
// through a tiny stand-in for Upstash's REST API that forwards each command
// to a real Redis over its own protocol:
//   docker run -d -p 56379:6379 redis:7-alpine
//   REDIS_TEST_PORT=56379 npm run test:unit
const REDIS_PORT = Number(process.env.REDIS_TEST_PORT) || 0;

type Reply = string | number | null | Reply[] | { error: string };

function encodeCommand(command: unknown[]): Buffer {
  const parts = command.map((arg) => Buffer.from(String(arg)));
  return Buffer.concat([
    Buffer.from(`*${parts.length}\r\n`),
    ...parts.flatMap((part) => [Buffer.from(`$${part.length}\r\n`), part, Buffer.from("\r\n")]),
  ]);
}

/** Parses one RESP reply from the start of `buf`, or null if it is incomplete. */
function parseReply(buf: Buffer, at = 0): { value: Reply; next: number } | null {
  const end = buf.indexOf("\r\n", at);
  if (end < 0) return null;
  const type = String.fromCharCode(buf[at]);
  const line = buf.toString("utf8", at + 1, end);
  const after = end + 2;
  if (type === "+") return { value: line, next: after };
  if (type === "-") return { value: { error: line }, next: after };
  if (type === ":") return { value: Number(line), next: after };
  if (type === "$") {
    const length = Number(line);
    if (length < 0) return { value: null, next: after };
    if (buf.length < after + length + 2) return null;
    return { value: buf.toString("utf8", after, after + length), next: after + length + 2 };
  }
  if (type === "*") {
    const count = Number(line);
    const items: Reply[] = [];
    let cursor = after;
    for (let i = 0; i < count; i += 1) {
      const item = parseReply(buf, cursor);
      if (!item) return null;
      items.push(item.value);
      cursor = item.next;
    }
    return { value: items, next: cursor };
  }
  throw new Error(`unexpected RESP type ${type}`);
}

function redisCommand(port: number, command: unknown[]): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let pending = Buffer.alloc(0);
    socket.on("connect", () => socket.write(encodeCommand(command)));
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      const parsed = parseReply(pending);
      if (parsed) {
        socket.end();
        resolve(parsed.value);
      }
    });
    socket.on("error", reject);
  });
}

function startRestShim(port: number): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", async () => {
        const reply = await redisCommand(port, JSON.parse(Buffer.concat(chunks).toString()));
        const body = reply && typeof reply === "object" && !Array.isArray(reply) ? reply : { result: reply };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(body));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("upstashTokenBucket on a real Redis", { skip: REDIS_PORT ? undefined : "set REDIS_TEST_PORT to run against Redis" }, () => {
  const unique = () => `rl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const withShim = async (run: (env: Record<string, string>) => Promise<void>) => {
    const { server, url } = await startRestShim(REDIS_PORT);
    try {
      await run({ UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: "t" });
    } finally {
      server.close();
    }
  };

  it("allows exactly `capacity` of 50 rapid requests", async () => {
    await withShim(async (env) => {
      const key = unique();
      // A slow refill: Redis keeps its own real clock, so on a busy machine a
      // fast one would hand back a token in the middle of the loop.
      const spec = { capacity: 20, refillEveryMs: 120_000 };
      const results = [];
      for (let i = 0; i < 50; i += 1) results.push(await upstashTokenBucket({ key, spec, env, timeoutMs: 10_000 }));
      assert.equal(results.filter((r) => r.allowed).length, 20);
      assert.deepEqual(
        results.slice(0, 20).map((r) => r.remaining),
        Array.from({ length: 20 }, (_, i) => 19 - i),
      );
      assert.ok(results.slice(20).every((r) => r.retryAfterMs >= 1 && r.retryAfterMs <= 120_000));
    });
  });

  it("allows exactly `capacity` of 60 simultaneous requests", async () => {
    await withShim(async (env) => {
      const key = unique();
      const spec = { capacity: 10, refillEveryMs: 60_000 };
      // The stand-in server opens a connection per command, so give a loaded
      // machine more than the production 1.5 s leash.
      const results = await Promise.all(
        Array.from({ length: 60 }, () => upstashTokenBucket({ key, spec, env, timeoutMs: 10_000 })),
      );
      assert.equal(results.filter((r) => r.allowed).length, 10);
    });
  });

  it("is exact when the refill interval is not a whole number of milliseconds", async () => {
    await withShim(async (env) => {
      const key = unique();
      const spec = { capacity: 7, refillEveryMs: 60_000 / 7 };
      const results = [];
      for (let i = 0; i < 12; i += 1) results.push(await upstashTokenBucket({ key, spec, env }));
      assert.equal(results.filter((r) => r.allowed).length, 7);
    });
  });

  /**
   * Time passing, without waiting for it: the key holds the moment the bucket is
   * full again, so moving that back is what real time would do. No sleeps for a
   * busy machine to stretch.
   */
  const rewind = async (key: string, ms: number) => {
    const redisKey = `tb:${key}`;
    const full = Number(await redisCommand(REDIS_PORT, ["GET", redisKey]));
    await redisCommand(REDIS_PORT, ["SET", redisKey, (full - ms).toFixed(3), "PX", 60_000]);
  };

  it("tells a refused caller how long to wait, does not charge for refusals, and recovers", async () => {
    await withShim(async (env) => {
      const key = unique();
      const spec = { capacity: 1, refillEveryMs: 60_000 };
      assert.equal((await upstashTokenBucket({ key, spec, env })).allowed, true);
      const refused = await upstashTokenBucket({ key, spec, env });
      assert.equal(refused.allowed, false);
      assert.ok(
        refused.retryAfterMs > 55_000 && refused.retryAfterMs <= 60_000,
        `a minute minus the milliseconds already spent, got ${refused.retryAfterMs}`,
      );
      // If refusals were charged, these 20 would add 20 minutes to the wait.
      for (let i = 0; i < 20; i += 1) await upstashTokenBucket({ key, spec, env });
      await rewind(key, refused.retryAfterMs - 2_000);
      assert.equal((await upstashTokenBucket({ key, spec, env })).allowed, false, "two seconds early is still too early");
      await rewind(key, 2_000 + 100);
      assert.equal((await upstashTokenBucket({ key, spec, env })).allowed, true, "waiting the advertised time is enough");
    });
  });

  it("charges `cost` tokens", async () => {
    await withShim(async (env) => {
      const key = unique();
      const spec = { capacity: 10, refillEveryMs: 60_000 };
      assert.equal((await upstashTokenBucket({ key, spec, env, cost: 4 })).remaining, 6);
      assert.equal((await upstashTokenBucket({ key, spec, env, cost: 4 })).remaining, 2);
      assert.equal((await upstashTokenBucket({ key, spec, env, cost: 4 })).allowed, false);
      assert.equal((await upstashTokenBucket({ key, spec, env, cost: 2 })).allowed, true);
    });
  });

  it("expires the key when the bucket is full again, so idle buckets cost nothing", async () => {
    await withShim(async (env) => {
      const key = unique();
      const spec = { capacity: 2, refillEveryMs: 500 };
      await upstashTokenBucket({ key, spec, env });
      await upstashTokenBucket({ key, spec, env });
      const ttl = Number(await redisCommand(REDIS_PORT, ["PTTL", `tb:${key}`]));
      assert.ok(ttl > 0 && ttl <= 1_000, `expires within the refill time, got ${ttl} ms`);
      await sleep(1_200);
      assert.equal(await redisCommand(REDIS_PORT, ["EXISTS", `tb:${key}`]), 0);
      assert.equal((await upstashTokenBucket({ key, spec, env })).remaining, 1, "a gone key is a full bucket");
    });
  });
});
