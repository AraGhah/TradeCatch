import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { isE2eHarness } from "@/lib/config";
import { readGmailEnv, type GmailEnv } from "./oauth";

const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
  { timeoutDuration: 5_000, cooldownDuration: 30_000 },
);
let testKeys: ReturnType<typeof createRemoteJWKSet> | undefined;
let testKeysUrl: string | undefined;

function keysForRuntime(): JWTVerifyGetKey {
  // Only the isolated localhost harness may substitute Google's public keys.
  const base = process.env.GMAIL_TEST_GOOGLE_BASE?.trim();
  if (isE2eHarness() && base) {
    const url = `${base.replace(/\/$/, "")}/oauth2/v3/certs`;
    if (!testKeys || testKeysUrl !== url) {
      // Retry workers rotate their fake provider immediately. Google's production
      // verifier above retains its normal refresh cooldown.
      testKeys = createRemoteJWKSet(new URL(url), { cooldownDuration: 0 });
      testKeysUrl = url;
    }
    return testKeys;
  }
  return googleKeys;
}

/** No URL credentials, token introspection URLs, payloads or errors are logged. */
export async function authorizeGmailPush(
  request: Request,
  env: GmailEnv = readGmailEnv(),
  keys: JWTVerifyGetKey = keysForRuntime(),
): Promise<boolean> {
  if (!env.pushAudience || !env.pushServiceAccount) return false;
  // Reject old callback URLs even if accompanied by a valid bearer token.
  if (new URL(request.url).search) return false;
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/i.exec(header);
  if (!match || match[1].length > 8192) return false;
  try {
    const { payload } = await jwtVerify(match[1], keys, {
      algorithms: ["RS256"],
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: env.pushAudience,
      requiredClaims: ["exp", "iat", "sub", "email", "email_verified"],
      maxTokenAge: "2h",
      clockTolerance: 30,
    });
    return (
      payload.email === env.pushServiceAccount &&
      payload.email_verified === true &&
      typeof payload.sub === "string" &&
      payload.sub.length > 0
    );
  } catch {
    return false;
  }
}
