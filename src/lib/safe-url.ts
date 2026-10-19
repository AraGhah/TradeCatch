import { z } from "zod";

/**
 * Validation for URLs that a customer types in and the server later calls (the
 * CRM webhook) or texts to their own customers (the review link).
 *
 * A server-side request to an address the customer chose can reach things the
 * customer cannot: cloud metadata services, databases, admin ports on the
 * private network. The rules below accept only a public https host name.
 */

const MAX_URL_LENGTH = 2048;

// Names that only ever resolve inside a private network.
const INTERNAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".intranet",
  ".corp",
  ".private",
  ".home.arpa",
  ".cluster.local",
];

export type UrlCheck =
  | { ok: true; url: URL }
  | {
      ok: false;
      reason: "invalid" | "length" | "scheme" | "credentials" | "port" | "host";
    };

function ipv4Octets(host: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((n) => n <= 255) ? octets : null;
}

function isNonPublicIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, including cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast and reserved
  );
}

/** True for any address that is not a normal public internet address. */
export function isNonPublicAddress(address: string): boolean {
  const v4 = ipv4Octets(address);
  if (v4) return isNonPublicIpv4(v4);
  const lower = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (!lower.includes(":")) return true; // not an address at all
  const mapped = /^(?:::ffff:|0:0:0:0:0:ffff:)(\d+\.\d+\.\d+\.\d+)$/.exec(
    lower,
  );
  if (mapped) {
    const octets = ipv4Octets(mapped[1]!);
    return octets ? isNonPublicIpv4(octets) : true;
  }
  // Global unicast is 2000::/3; everything else (loopback, unique-local,
  // link-local, multicast, unspecified) is not public. Documentation range too.
  return !/^[23]/.test(lower) || lower.startsWith("2001:db8");
}

/** Syntax and host-name rules. Does not touch the network. */
export function checkOutboundUrl(raw: string): UrlCheck {
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: "length" };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (url.port !== "" && url.port !== "443")
    return { ok: false, reason: "port" };

  // WHATWG parsing already turns 2130706433, 0x7f.1 and 017700000001 into 127.0.0.1,
  // so refusing every IPv4 literal closes all of those spellings at once. IPv6
  // literals are refused too: a real service has a name and a certificate for it.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.startsWith("[") || host.includes(":") || ipv4Octets(host))
    return { ok: false, reason: "host" };
  if (!host.includes(".")) return { ok: false, reason: "host" };
  if (
    host === "localhost" ||
    INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
  )
    return { ok: false, reason: "host" };
  if (!/\.[a-z][a-z0-9-]*$/.test(host)) return { ok: false, reason: "host" };
  return { ok: true, url };
}

export type HostResolver = (hostname: string) => Promise<string[]>;

async function nodeResolver(hostname: string): Promise<string[]> {
  const { lookup } = await import("node:dns/promises");
  const records = await lookup(hostname, { all: true });
  return records.map((record) => record.address);
}

/**
 * Resolves the host and reports whether every address is public. Catches names
 * like 127.0.0.1.nip.io that pass the syntax rules but point inside. Returns
 * "unknown" where the runtime cannot resolve names (the request then fails on
 * its own if the name does not exist); the Cloudflare Workers network also
 * cannot reach private ranges.
 */
export async function hostResolution(
  hostname: string,
  resolver: HostResolver = nodeResolver,
): Promise<"public" | "non-public" | "unknown"> {
  let addresses: string[];
  try {
    addresses = await resolver(hostname);
  } catch {
    return "unknown";
  }
  if (addresses.length === 0) return "unknown";
  return addresses.some(isNonPublicAddress) ? "non-public" : "public";
}

/** Zod field for a customer-supplied URL that the server will call or send out. */
export function publicHttpsUrl() {
  return z
    .string()
    .max(MAX_URL_LENGTH)
    .url()
    .refine((value) => checkOutboundUrl(value).ok, {
      message: "Use a public https:// address with no username or password.",
    });
}
