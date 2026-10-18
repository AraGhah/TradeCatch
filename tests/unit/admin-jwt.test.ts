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
