import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createId, randomUUID } from "../../src/lib/id";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomUUID", () => {
  it("returns a RFC 4122 version-4 UUID via native crypto when available", () => {
    const id = randomUUID();
    assert.match(id, UUID_RE);
  });

  it("falls back to getRandomValues when randomUUID is missing", () => {
    const original = globalThis.crypto;
    const getRandomValues = original.getRandomValues.bind(original);

    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { getRandomValues },
    });

    try {
      assert.equal(typeof globalThis.crypto.randomUUID, "undefined");
      const id = randomUUID();
      assert.match(id, UUID_RE);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: original,
      });
    }
  });

  it("createId prefixes a UUID", () => {
    const id = createId("bal");
    assert.match(id, new RegExp(`^bal_${UUID_RE.source.slice(1, -1)}$`));
  });
});
