import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_JWT_TTL_SECONDS,
  signAdminJwt,
  verifyAdminJwt,
} from "../../src/product/saas/auth/admin-jwt";

const secret = "test-admin-jwt-secret";

describe("admin JWT", () => {
  it("accepts a token signed for this admin session", async () => {
    const token = await signAdminJwt({ sub: "usr_1", sid: "ses_1" }, secret, 1_700_000_000_000);
    const claims = await verifyAdminJwt(token, secret, 1_700_000_000_000);
    assert.ok(claims);
    assert.equal(claims.sub, "usr_1");
    assert.equal(claims.sid, "ses_1");
    assert.equal(claims.role, "platform_admin");
    assert.equal(claims.exp - claims.iat, ADMIN_JWT_TTL_SECONDS);
  });

  it("rejects a normal session cookie, a tampered token, the wrong secret, and expiry", async () => {
    const token = await signAdminJwt({ sub: "usr_1", sid: "ses_1" }, secret, 1_700_000_000_000);
    const [header, payload, sig] = token.split(".");
    const tamperedPayload = payload!.slice(0, -2) + (payload!.endsWith("a") ? "b" : "a");

    assert.equal(await verifyAdminJwt("not-a-jwt", secret), null);
    assert.equal(await verifyAdminJwt(`${header}.${tamperedPayload}.${sig}`, secret, 1_700_000_000_000), null);
    assert.equal(await verifyAdminJwt(token, "other-secret", 1_700_000_000_000), null);
    assert.equal(
      await verifyAdminJwt(token, secret, 1_700_000_000_000 + (ADMIN_JWT_TTL_SECONDS + 5) * 1000),
      null,
    );
  });

  it("accepts only the canonical spelling of the signature", async () => {
    const token = await signAdminJwt({ sub: "usr_1", sid: "ses_1" }, secret, 1_700_000_000_000);
    const [header, payload, sig] = token.split(".");
    assert.ok(await verifyAdminJwt(token, secret, 1_700_000_000_000));
    assert.equal(
      await verifyAdminJwt(`${header}.${payload}.${respellSignature(sig!)}`, secret, 1_700_000_000_000),
      null,
    );
    assert.equal(await verifyAdminJwt(`${header}.${payload}.${sig}=`, secret, 1_700_000_000_000), null);
  });

  it("rejects an unsigned token that claims the admin role", async () => {
    const header = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
    const payload = b64url(
      JSON.stringify({
        iss: "tradecatch",
        aud: "tradecatch-admin",
        sub: "usr_1",
        sid: "ses_1",
        role: "platform_admin",
        iat: 1,
        exp: 9_999_999_999,
        jti: "x",
      }),
    );
    assert.equal(await verifyAdminJwt(`${header}.${payload}.`, secret), null);
  });
});

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * A 32-byte HMAC ends in a character that carries 4 data bits and 2 unused
 * bits, so changing only the unused bits yields a different string that
 * decodes to the same signature.
 */
function respellSignature(sig: string): string {
  const index = BASE64URL.indexOf(sig.at(-1)!);
  return sig.slice(0, -1) + BASE64URL[(index & ~3) | ((index + 1) & 3)];
}
