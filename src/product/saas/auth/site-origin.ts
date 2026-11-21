import { isE2eHarness, isProductionRuntime } from "@/lib/config";

/**
 * Where a link we email points. A password-reset or activation link carries a
 * secret, so the address in it must be one we configured, never one a request
 * told us: a forged Host or X-Forwarded-Host header would otherwise send the
 * victim's token to the attacker's site.
 *
 * Rules:
 *  - `NEXT_PUBLIC_SITE_URL` wins when it is an https URL (plain http is
 *    accepted only for a loopback host in local development or the end-to-end
 *    harness). Any path, query or credentials in it are dropped.
 *  - Outside production, with nothing configured, the address the request came
 *    to is used so `next dev` and tests keep working.
 *  - Production never trusts the request: it falls back to the canonical site.
 */
const CANONICAL_ORIGIN = "https://tradecatch.ca";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseOrigin(
  value: string | undefined,
  allowLoopbackHttp: boolean,
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url.origin;
  if (
    url.protocol === "http:" &&
    allowLoopbackHttp &&
    LOOPBACK_HOSTS.has(url.hostname)
  ) {
    return url.origin;
  }
  return null;
}

export function trustedSiteOrigin(requestOrigin?: string): string {
  const production = isProductionRuntime();
  const configured = parseOrigin(
    process.env.NEXT_PUBLIC_SITE_URL,
    !production || isE2eHarness(),
  );
  if (configured) return configured;
  if (!production) {
    const fromRequest = parseOrigin(requestOrigin, true);
    if (fromRequest) return fromRequest;
  }
  return CANONICAL_ORIGIN;
}
