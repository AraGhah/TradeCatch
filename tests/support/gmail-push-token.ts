import { createHash, generateKeyPairSync } from "node:crypto";
import { SignJWT } from "jose";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
// A restarted fake provider must advertise a new key ID, as Google does when
// rotating keys, so the running application's JWKS cache can refresh it.
const kid = createHash("sha256")
  .update(publicKey.export({ format: "der", type: "spki" }))
  .digest("hex");
export const testGoogleJwks = {
  keys: [
    {
      ...publicKey.export({ format: "jwk" }),
      kid,
      alg: "RS256",
      use: "sig",
    },
  ],
};
export async function testPushToken(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: "https://accounts.google.com",
    aud: `http://localhost:${process.env.TRADECATCH_E2E_PORT || 3100}/api/webhooks/gmail`,
    sub: "123456",
    iat: now,
    exp: now + 3600,
    email: "gmail-push@e2e.iam.gserviceaccount.com",
    email_verified: true,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid })
    .sign(privateKey);
}
