import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import {
  BodyTooLargeError,
  contentLengthExceeds,
  readBodyText,
  readJsonBody,
} from "../../src/lib/request-body";
import { POST as clientError } from "../../src/app/api/client-error/route";
import { POST as magicLink } from "../../src/app/api/auth/magic-link/route";
import { POST as stripeWebhook } from "../../src/app/api/webhooks/stripe/route";

const URL = "http://localhost/api/x";

/** A body with no Content-Length, the way a chunked upload arrives. */
function chunked(parts: string[]): RequestInit {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < parts.length) controller.enqueue(encoder.encode(parts[index++]));
        else controller.close();
      },
    }),
    // Required by Node's fetch for streamed bodies.
    duplex: "half",
  } as RequestInit;
}

describe("readBodyText", () => {
  it("returns a body within the limit, including at exactly the limit", async () => {
    assert.equal(await readBodyText(new Request(URL, { method: "POST", body: "hello" }), 100), "hello");
    assert.equal(await readBodyText(new Request(URL, { method: "POST", body: "12345" }), 5), "12345");
    assert.equal(await readBodyText(new Request(URL, { method: "POST" }), 5), "");
  });

  it("rejects a body whose declared length is over the limit without reading it", async () => {
    // An inbound request carries the header from the wire; a locally built one does not.
    const request = new Request(URL, { method: "POST", body: "x".repeat(50), headers: { "content-length": "50" } });
    assert.equal(request.headers.get("content-length"), "50");
    assert.equal(contentLengthExceeds(request, 10), true);
    assert.equal(contentLengthExceeds(request, 50), false);
    await assert.rejects(() => readBodyText(request, 10), BodyTooLargeError);

    // A lying header cannot be used to smuggle a larger body past the limit.
    const lying = new Request(URL, { method: "POST", body: "x".repeat(50), headers: { "content-length": "3" } });
    await assert.rejects(() => readBodyText(lying, 10), BodyTooLargeError);
  });

  it("stops a chunked upload that sends no Content-Length once it crosses the limit", async () => {
    const request = new Request(URL, chunked(["a".repeat(60), "b".repeat(60), "c".repeat(60)]));
    assert.equal(request.headers.get("content-length"), null);
    assert.equal(contentLengthExceeds(request, 100), false, "the header cannot catch this one");
    await assert.rejects(() => readBodyText(request, 100), BodyTooLargeError);
  });

  it("accepts a chunked upload that stays within the limit and keeps multi-byte text intact", async () => {
    const request = new Request(URL, chunked(["caf", "é ", "日本"]));
    assert.equal(await readBodyText(request, 64), "café 日本");
  });
});

describe("readJsonBody", () => {
  it("parses valid JSON", async () => {
    const read = await readJsonBody(new Request(URL, { method: "POST", body: '{"a":1}' }), 100);
    assert.deepEqual(read, { ok: true, data: { a: 1 } });
  });

  it("reports 400 for malformed or empty JSON and 413 for an oversized body", async () => {
    assert.deepEqual(await readJsonBody(new Request(URL, { method: "POST", body: "{nope" }), 100), {
      ok: false,
      status: 400,
      error: "Invalid JSON.",
    });
    assert.equal((await readJsonBody(new Request(URL, { method: "POST" }), 100)).ok, false);
    assert.deepEqual(await readJsonBody(new Request(URL, { method: "POST", body: JSON.stringify({ a: "x".repeat(500) }) }), 100), {
      ok: false,
      status: 413,
      error: "Payload too large.",
    });
  });
});

describe("public endpoints refuse oversized bodies", () => {
  const big = JSON.stringify({ message: "x".repeat(200_000) });

  it("client-error", async () => {
    const res = await clientError(
      new NextRequest("http://localhost/api/client-error", {
        method: "POST",
        body: big,
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.50" },
      }),
    );
    assert.equal(res.status, 413);
  });

  it("magic-link request", async () => {
    const res = await magicLink(
      new NextRequest("http://localhost/api/auth/magic-link", {
        method: "POST",
        body: JSON.stringify({ email: `${"a".repeat(10_000)}@example.com` }),
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.51" },
      }),
    );
    assert.equal(res.status, 413);
  });

  it("Stripe webhook, before any signature work", async () => {
    const res = await stripeWebhook(
      new NextRequest("http://localhost/api/webhooks/stripe", {
        method: "POST",
        body: "x".repeat(600 * 1024),
        headers: { "stripe-signature": "t=1,v1=00" },
      }),
    );
    assert.equal(res.status, 413);
  });

  it("still serves a normal Stripe request to the signature check", async () => {
    const res = await stripeWebhook(
      new NextRequest("http://localhost/api/webhooks/stripe", {
        method: "POST",
        body: '{"id":"evt_1","type":"x"}',
        headers: { "stripe-signature": "t=1,v1=00" },
      }),
    );
    assert.equal(res.status, 401);
  });

  it("an oversized streamed body with no Content-Length is refused too", async () => {
    const init = chunked(Array.from({ length: 10 }, () => "z".repeat(10_000)));
    const res = await magicLink(
      new NextRequest("http://localhost/api/auth/magic-link", {
        ...init,
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.52" },
      } as ConstructorParameters<typeof NextRequest>[1]),
    );
    assert.equal(res.status, 413);
  });
});
