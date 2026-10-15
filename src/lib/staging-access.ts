/**
 * HTTP Basic gate for the staging Worker when Cloudflare Access is not yet
 * configured. Only evaluated when TRADECATCH_ENV=staging (or demo mode) and
 * both STAGING_BASIC_AUTH_USER / STAGING_BASIC_AUTH_PASSWORD are set.
 */

type RuntimeEnvironment = Record<string, string | undefined>;

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function getStagingBasicCredentials(
  env: RuntimeEnvironment = process.env,
): { user: string; password: string } | null {
  const user = env.STAGING_BASIC_AUTH_USER?.trim() ?? "";
  const password = env.STAGING_BASIC_AUTH_PASSWORD?.trim() ?? "";
  if (!user || !password) return null;
  return { user, password };
}

export function authorizeStagingBasicAuth(
  authorizationHeader: string | null,
  env: RuntimeEnvironment = process.env,
): boolean {
  const expected = getStagingBasicCredentials(env);
  if (!expected) return true; // gate not configured

  if (!authorizationHeader?.startsWith("Basic ")) return false;
  const encoded = authorizationHeader.slice("Basic ".length).trim();
  if (!encoded) return false;

  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return false;
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  return (
    timingSafeEqualString(user, expected.user) &&
    timingSafeEqualString(password, expected.password)
  );
}

export function stagingUnauthorizedResponse(): Response {
  return new Response("Staging access requires authorization.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="TradeCatch Staging", charset="UTF-8"',
      "Cache-Control": "no-store",
      "x-tradecatch-env": "staging",
    },
  });
}
