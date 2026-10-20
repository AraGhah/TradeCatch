import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { POST } from "../../src/app/api/book-audit/route";
import { closePgPool } from "../../src/product/missed-call/postgres-store";

const envKeys = [
  "NODE_ENV",
  "TRADECATCH_ENV",
  "TRADECATCH_E2E",
  "VERCEL_ENV",
  "CF_TRUSTED",
  "DATABASE_URL",
  "MISSED_CALL_DURABLE_STORE",
  "SAAS_DURABLE_STORE",
  "TURNSTILE_SECRET_KEY",
  "ERROR_WEBHOOK_URL",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "RESEND_NOTIFY_EMAIL",
  "LEADS_WEBHOOK_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;
const savedEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const originalQuery = Pool.prototype.query;
type Rows = { rows: Record<string, unknown>[] };
let insert: (params: unknown[]) => Promise<Rows>;
let inserts: number;
let deliveries: number;
let ip = 0;

function payload() {
  return {
    firstName: "TC001",
    lastName: "Test",
    company: "Fictional Staging Plumbing",
    trade: "Plumbing",
    email: "tc001@example.com",
    phone: "514-555-0100",
    city: "Laval",
    preferredLanguage: "en",
    serviceConsent: true,
    marketingConsent: false,
    consentWording: "Contact me about this request.",
    turnstileToken: "test-token",
    idempotencyKey: randomUUID(),
  };
}

function submit(data = payload()) {
  return POST(
    new NextRequest("https://staging.example.com/api/book-audit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": `192.0.2.${++ip}`,
      },
      body: JSON.stringify(data),
    }),
  );
}

beforeEach(() => {
  for (const key of envKeys) delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: "production",
    TRADECATCH_ENV: "staging",
    CF_TRUSTED: "1",
    MISSED_CALL_DURABLE_STORE: "1",
    DATABASE_URL: "postgresql://test:test@localhost:1/tc001_test",
    RESEND_API_KEY: "re_test_only",
    RESEND_FROM_EMAIL: "test@example.com",
    RESEND_NOTIFY_EMAIL: "ops@example.com",
    LEADS_WEBHOOK_URL: "https://crm.example.com",
  });
  inserts = 0;
  deliveries = 0;
  insert = async () => ({
    rows: [{ id: "bal_test", email_sent: false, crm_forwarded: false }],
  });
  Reflect.set(
    Pool.prototype,
    "query",
    async (sql: string, params: unknown[] = []) => {
      if (sql.includes("tc_rate_limits"))
        return { rows: [{ count: 1, reset_ms: Date.now() + 600_000 }] };
      if (sql.includes("INSERT INTO mc_book_audit_leads")) {
        inserts++;
        return insert(params);
      }
      if (sql.includes("SELECT id, email_sent"))
        return {
          rows: [{ id: "bal_existing", email_sent: true, crm_forwarded: true }],
        };
      if (sql.includes("RETURNING email_sent"))
        return { rows: [{ email_sent: false, crm_forwarded: false }] };
      return { rows: [] };
    },
  );
  mock.method(globalThis, "fetch", async () => {
    deliveries++;
    return Response.json(
      { message: "Simulated delivery failure" },
      { status: 503 },
    );
  });
  mock.method(console, "error", () => {});
  mock.method(console, "warn", () => {});
  mock.method(console, "info", () => {});
});

afterEach(() => {
  mock.restoreAll();
  Reflect.set(Pool.prototype, "query", originalQuery);
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else Reflect.set(process.env, key, value);
  }
});
after(closePgPool);

describe("book-audit durable acceptance", () => {
  for (const environment of ["staging", "production"]) {
    it(`rejects disabled storage on ${environment}, including repeated submissions`, async () => {
      process.env.TRADECATCH_ENV = environment;
      delete process.env.MISSED_CALL_DURABLE_STORE;
      const data = payload();
      for (let i = 0; i < 2; i++) {
        const response = await submit(data);
        assert.equal(response.status, 503);
        assert.equal(
          ((await response.json()) as { ok?: boolean }).ok,
          undefined,
        );
      }
      assert.equal(inserts, 0);
      assert.equal(deliveries, 0);
    });
  }

  it("rejects a missing database URL even with the durable flag enabled", async () => {
    delete process.env.DATABASE_URL;
    const response = await submit();
    assert.equal(response.status, 503);
    assert.equal(inserts, 0);
    assert.equal(deliveries, 0);
  });

  it("rejects unavailable storage before consuming a Turnstile token", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-only";
    delete process.env.MISSED_CALL_DURABLE_STORE;
    assert.equal((await submit()).status, 503);
    assert.equal(deliveries, 0);
  });

  it("returns 503 for a failed save and allows the same key to be saved on retry", async () => {
    const data = payload();
    const save = insert;
    insert = async () => {
      throw new Error("Simulated PostgreSQL outage");
    };
    const failed = await submit(data);
    assert.equal(failed.status, 503);
    assert.equal(deliveries, 0);
    insert = save;
    const retried = await submit(data);
    assert.equal(retried.status, 200);
    assert.equal(((await retried.json()) as { ok?: boolean }).ok, true);
    assert.equal(inserts, 2);
  });

  it("does not acknowledge concurrent duplicates while both saves fail", async () => {
    const data = payload();
    let fail!: () => void;
    const saving = new Promise<void>((resolve) => {
      fail = resolve;
    });
    insert = async () => {
      await saving;
      throw new Error("Simulated failed transaction");
    };
    const pending = [submit(data), submit(data)];
    await new Promise((resolve) => setImmediate(resolve));
    fail();
    const responses = await Promise.all(pending);
    assert.deepEqual(
      responses.map((response) => response.status),
      [503, 503],
    );
    assert.equal(inserts, 2);
    assert.equal(deliveries, 0);
  });

  it("does not trust a Redis duplicate claim as evidence of persistence", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.com";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-only";
    const commands: string[] = [];
    mock.method(
      globalThis,
      "fetch",
      async (_url: unknown, init?: RequestInit) => {
        const [command] = JSON.parse(String(init?.body));
        commands.push(command);
        return Response.json({
          result: command === "INCR" ? 1 : command === "TTL" ? 600 : null,
        });
      },
    );
    insert = async () => {
      throw new Error("Simulated PostgreSQL outage");
    };
    assert.equal((await submit()).status, 503);
    assert.equal(inserts, 1);
    assert.equal(commands.includes("SET"), false);
  });

  it("accepts a saved lead when email and CRM fail, only delivering after the save", async () => {
    const save = insert;
    insert = async (params) => {
      assert.equal(deliveries, 0);
      const storedPayload = JSON.parse(String(params[11]));
      assert.equal(storedPayload.turnstileToken, undefined);
      assert.equal(storedPayload.email, "tc001@example.com");
      return save(params);
    };
    const response = await submit();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      emailSent: false,
      crmForwarded: false,
    });
    assert.equal(inserts, 1);
    assert.equal(deliveries, 2);
  });

  it("acknowledges duplicates only after PostgreSQL finds the saved lead", async () => {
    insert = async () => ({ rows: [] });
    const response = await submit();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, duplicate: true });
    assert.equal(inserts, 1);
    assert.equal(deliveries, 0);
  });
});
