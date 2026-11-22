/**
 * Characterization test for the shared Twilio webhook prelude (KAN-30): every
 * route below reads a bounded form post, then verifies the Twilio signature,
 * before touching any store. Twilio and our alerting depend on these exact
 * statuses and bodies, so they are pinned here.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";

const managed = [
  "NODE_ENV",
  "TRADECATCH_ENV",
  "TWILIO_AUTH_TOKEN",
  "MISSED_CALL_SKIP_TWILIO_VALIDATE",
];
const original = new Map(managed.map((key) => [key, process.env[key]]));

function setNodeEnv(value: string) {
  (process.env as { NODE_ENV?: string }).NODE_ENV = value;
}

beforeEach(() => {
  managed.forEach((key) => delete process.env[key]);
  setNodeEnv("development");
  mock.method(console, "warn", () => {});
  mock.method(console, "info", () => {});
  mock.method(console, "error", () => {});
});

afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

type Handler = (request: NextRequest) => Promise<Response>;

const ROUTES: { path: string; load: () => Promise<Handler> }[] = [
  {
    path: "/api/twilio/sms/status",
    load: async () => (await import("../../src/app/api/twilio/sms/status/route")).POST,
  },
  {
    path: "/api/twilio/voice/status",
    load: async () => (await import("../../src/app/api/twilio/voice/status/route")).POST,
  },
  {
    path: "/api/twilio/voice/inbound",
    load: async () => (await import("../../src/app/api/twilio/voice/inbound/route")).POST,
  },
  {
    path: "/api/webhooks/twilio/relay-ended",
    load: async () =>
      (await import("../../src/app/api/webhooks/twilio/relay-ended/route")).POST,
  },
];

type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

function formRequest(path: string, body: BodyInit, headers: Record<string, string> = {}) {
  // `duplex` is required by Node's fetch for a streamed body; it is not in the DOM type.
  const init = {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
    duplex: "half",
  } as NextRequestInit;
  return new NextRequest(`http://localhost${path}`, init);
}

function brokenStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull(controller) {
      controller.error(new Error("connection reset"));
    },
  });
}

describe("Twilio webhook prelude (bounded form + signature)", () => {
  for (const route of ROUTES) {
    describe(route.path, () => {
      it("answers 413 Payload too large for a body over the limit", async () => {
        const POST = await route.load();
        const big = "Body=" + "x".repeat(300_000);
        const res = await POST(formRequest(route.path, big));
        assert.equal(res.status, 413);
        assert.deepEqual(await res.json(), { error: "Payload too large" });
      });

      it("answers 413 from Content-Length alone, before reading", async () => {
        const POST = await route.load();
        const res = await POST(
          formRequest(route.path, "From=%2B15145551234", { "content-length": "999999" }),
        );
        assert.equal(res.status, 413);
        assert.deepEqual(await res.json(), { error: "Payload too large" });
      });

      it("answers 400 Invalid form when the body cannot be read", async () => {
        const POST = await route.load();
        const res = await POST(formRequest(route.path, brokenStream()));
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { error: "Invalid form" });
      });

      it("answers 403 Invalid signature for a forged signature in production", async () => {
        setNodeEnv("production");
        process.env.TRADECATCH_ENV = "production";
        process.env.TWILIO_AUTH_TOKEN = "real-token";
        const POST = await route.load();
        const res = await POST(
          formRequest(
            route.path,
            new URLSearchParams({ CallSid: "CA123", MessageSid: "SM123", From: "+15145551234" }).toString(),
            { "x-twilio-signature": "forged" },
          ),
        );
        assert.equal(res.status, 403);
        assert.deepEqual(await res.json(), { error: "Invalid signature" });
      });
    });
  }
});
