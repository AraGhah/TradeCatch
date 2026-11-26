import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jsQR from "jsqr";

import { QR_QUIET_ZONE, qrSvgPath } from "../../src/components/admin/otpauth-qr-path";
import { createMemorySecurityStore } from "../../src/product/security/store";
import { createSecurityService } from "../../src/product/security/service";
import { totpCode } from "../../src/product/security/totp";

const NOW = new Date("2026-11-25T12:00:00.000Z");

function service(secret = () => "test-secret", store = createMemorySecurityStore()) {
  return createSecurityService({
    store,
    now: () => NOW,
    secret,
    listSessions: async () => [],
    revokeSession: async () => {},
  });
}

/** Rasterise the SVG path the component draws and decode it like a phone camera would. */
function scan(value: string): string | null {
  const { size, path } = qrSvgPath(value);
  const scale = 6;
  const span = (size + QR_QUIET_ZONE * 2) * scale;
  const pixels = new Uint8ClampedArray(span * span * 4).fill(255);
  for (const [, x, y] of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    for (let dy = 0; dy < scale; dy += 1) {
      for (let dx = 0; dx < scale; dx += 1) {
        const px = (Number(x) + QR_QUIET_ZONE) * scale + dx;
        const py = (Number(y) + QR_QUIET_ZONE) * scale + dy;
        const at = (py * span + px) * 4;
        pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
      }
    }
  }
  return jsQR(pixels, span, span)?.data ?? null;
}

describe("administrator 2FA QR code", () => {
  it("RFC 6238 test vectors match, so authenticator apps agree with the server", () => {
    const rfc = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32 of "12345678901234567890"
    assert.equal(totpCode(rfc, 59_000), "287082");
    assert.equal(totpCode(rfc, 1_111_111_109_000), "081804");
  });

  it("the QR decodes to the exact otpauth URI that carries the stored secret", async () => {
    const monitor = service();
    const enrolled = await monitor.enrollMfa("user-1");
    const uri = new URL(enrolled.otpauth);
    assert.equal(uri.protocol, "otpauth:");
    assert.equal(uri.host, "totp");
    assert.equal(uri.searchParams.get("issuer"), "TradeCatch");
    assert.equal(uri.searchParams.get("secret"), enrolled.secret);
    assert.match(enrolled.secret, /^[A-Z2-7]{32}$/);

    assert.equal(scan(enrolled.otpauth), enrolled.otpauth);
  });

  it("completes activation with the code an authenticator derives from the scanned QR", async () => {
    const store = createMemorySecurityStore();
    const monitor = service(undefined, store);
    const enrolled = await monitor.enrollMfa("user-1");

    // What the phone does: scan, read the secret out of the URI, show a code.
    const scanned = new URL(scan(enrolled.otpauth)!);
    const phoneCode = totpCode(scanned.searchParams.get("secret")!, NOW.getTime());

    assert.equal(await monitor.mfaState("user-1", "ses_1"), "pending");
    await monitor.confirmMfa("user-1", "ses_1", phoneCode);
    assert.equal(await monitor.mfaState("user-1", "ses_1"), "verified");
    // Spaces the UI strips are also tolerated by the matcher.
    assert.equal(await monitor.sessionAllowsAdmin("user-1", "ses_1"), true);
  });

  it("asking for the setup key again does not replace a pending secret (the rejection cause)", async () => {
    const monitor = service();
    const first = await monitor.enrollMfa("user-1");
    // Reload, second tab or double click while still pending.
    const second = await monitor.enrollMfa("user-1");
    assert.equal(second.secret, first.secret);
    assert.equal(second.otpauth, first.otpauth);

    // The authenticator entry added from the FIRST display still works.
    await monitor.confirmMfa("user-1", "ses_1", totpCode(first.secret, NOW.getTime()));
    assert.equal(await monitor.mfaState("user-1", "ses_1"), "verified");
  });

  it("issues a fresh secret if the pending one can no longer be decrypted", async () => {
    const store = createMemorySecurityStore();
    const first = await service(() => "old-key", store).enrollMfa("user-1");
    const second = await service(() => "new-key", store).enrollMfa("user-1");
    assert.notEqual(second.secret, first.secret);
    await service(() => "new-key", store).confirmMfa(
      "user-1",
      "ses_1",
      totpCode(second.secret, NOW.getTime()),
    );
  });

  it("still refuses to re-enroll once verification is enabled", async () => {
    const monitor = service();
    const first = await monitor.enrollMfa("user-1");
    await monitor.confirmMfa("user-1", "ses_1", totpCode(first.secret, NOW.getTime()));
    await assert.rejects(() => monitor.enrollMfa("user-1"), /already set up/);
  });

  it("makes no network call to build the QR", () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      throw new Error("network used");
    }) as typeof fetch;
    try {
      scan("otpauth://totp/TradeCatch:x?secret=JBSWY3DPEHPK3PXP&issuer=TradeCatch");
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(calls, 0);
  });
});
