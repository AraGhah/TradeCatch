/**
 * Service-address handling for calls.
 *
 * The caller's address reaches us as speech turned into text, often in pieces
 * (street first, city later, postal code if they offer it). Three rules keep it
 * useful and keep a confirmed address from being lost:
 *
 *  - tidy: control characters and stray spacing are removed, and a Canadian
 *    postal code is written the standard way ("h7n1a1" -> "H7N 1A1");
 *  - complete: a street address has a civic number or at least three words
 *    ("Rang du Ruisseau"); a bare city is not enough for a technician;
 *  - never downgrade: once a complete address is on the call, a later, vaguer
 *    value (a city alone, a repeated fragment) does not replace it.
 */

const MAX_ADDRESS_CHARS = 300;
const POSTAL_CODE = /\b([A-Za-z]\d[A-Za-z])[\s-]?(\d[A-Za-z]\d)\b/;

/** Lower-case, accent-free text for comparisons. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/** One line, no control characters, standard postal code. Undefined when nothing is left. */
export function tidyAddress(raw: string | undefined | null): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*)+$/, "")
    .trim()
    .slice(0, MAX_ADDRESS_CHARS)
    .trim();
  if (!cleaned) return undefined;
  return cleaned.replace(
    POSTAL_CODE,
    (_match, first: string, second: string) =>
      `${first.toUpperCase()} ${second.toUpperCase()}`,
  );
}

/** A technician can find this: it has a civic number, or at least three words. */
export function addressIsComplete(address: string | undefined): boolean {
  if (!address) return false;
  if (/\d/.test(address)) return true;
  return address.split(/[\s,]+/).filter((word) => word.length > 1).length >= 3;
}

/** Adds the city the caller gave separately, unless the address already names it. */
export function withCity(
  address: string | undefined,
  city: string | undefined,
): string | undefined {
  if (!address) return address;
  const place = tidyAddress(city);
  if (!place) return address;
  if (fold(address).includes(fold(place))) return address;
  return tidyAddress(`${address}, ${place}`);
}

/**
 * The address to keep: the new one, unless it would replace a complete address
 * with an incomplete one.
 */
export function mergeAddress(
  existing: string | undefined,
  incoming: string | undefined,
): string | undefined {
  if (!incoming) return existing;
  if (existing && addressIsComplete(existing) && !addressIsComplete(incoming)) {
    return existing;
  }
  return incoming;
}
