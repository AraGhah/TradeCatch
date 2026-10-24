import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalJWKSet, generateKeyPair, SignJWT } from "jose";
import { authorizeGmailPush } from "../../src/product/gmail/push-auth";
import { testGoogleJwks, testPushToken } from "../support/gmail-push-token";

const env = {
  pushAudience: "http://localhost:3100/api/webhooks/gmail",
  pushServiceAccount: "gmail-push@e2e.iam.gserviceaccount.com",
};
const keys = createLocalJWKSet(testGoogleJwks);
const request = (token?: string, query = "") =>
  new Request(`${env.pushAudience}${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
test("Gmail push requires a signed Google identity and rejects URL credentials", async () => {
  const valid = await testPushToken();
  assert.equal(await authorizeGmailPush(request(valid), env, keys), true);
  for (const req of [
    request(),
    request(undefined, "?token=old-secret"),
    request(valid, "?token=old-secret"),
    request("garbage"),
    request("a".repeat(8193)),
  ]) {
    assert.equal(await authorizeGmailPush(req, env, keys), false);
  }
  for (const claims of [
    { email: "attacker@example.test" },
    { email_verified: false },
    { email_verified: "true" },
    { iss: "https://attacker.example" },
    { aud: "https://another.example" },
    { exp: 1 },
    { iat: Math.floor(Date.now() / 1000) + 3600 },
    { iat: Math.floor(Date.now() / 1000) - 10800 },
    { nbf: Math.floor(Date.now() / 1000) + 3600 },
    { exp: undefined },
    { iat: undefined },
    { sub: "" },
    { sub: undefined },
    { email: undefined },
    { email_verified: undefined },
  ]) {
    assert.equal(
      await authorizeGmailPush(request(await testPushToken(claims)), env, keys),
      false,
    );
  }
  assert.equal(
    await authorizeGmailPush(
      request(valid),
      { ...env, pushAudience: "wrong" },
      keys,
    ),
    false,
  );
  assert.equal(await authorizeGmailPush(request(valid), {}, keys), false);
  const { privateKey } = await generateKeyPair("RS256");
  const forged = await new SignJWT({
    email: env.pushServiceAccount,
    email_verified: true,
  })
    .setProtectedHeader({ alg: "RS256", kid: testGoogleJwks.keys[0].kid })
    .setIssuer("https://accounts.google.com")
    .setAudience(env.pushAudience)
    .setSubject("123")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  assert.equal(await authorizeGmailPush(request(forged), env, keys), false);
});

test("Gmail push fails closed when signing keys cannot be resolved", async () => {
  const valid = await testPushToken();
  assert.equal(
    await authorizeGmailPush(request(valid), env, async () => {
      throw new Error("Signing keys unavailable");
    }),
    false,
  );
});

test("Gmail push rejects symmetric signatures even with valid identity claims", async () => {
  const token = await new SignJWT({
    email: env.pushServiceAccount,
    email_verified: true,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("https://accounts.google.com")
    .setAudience(env.pushAudience)
    .setSubject("123")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode("attacker-controlled-symmetric-key"));
  assert.equal(await authorizeGmailPush(request(token), env, keys), false);
});
