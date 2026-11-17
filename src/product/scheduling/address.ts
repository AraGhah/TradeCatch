/**
 * Service-address normalisation (Canada). Pure, no I/O.
 *
 * A phone agent hears an address; it must not store whatever it heard. This
 * module turns free text or separate parts into one canonical address, says
 * exactly which part is still missing, and rejects the mistakes a voice
 * channel actually makes (a postal code that cannot belong to the province,
 * a P.O. box where a crew has to drive to).
 *
 * `addressesMatch` is also what the scheduler uses to decide whether two jobs
 * are at the same place, so "12 Main St" and "12 main street" are one place.
 */

export type AddressField =
  | "street_number"
  | "street"
  | "city"
  | "province"
  | "postal_code";

export type AddressInput = {
  /** Everything in one string, as heard. Separate parts below win over it. */
  address?: string;
  /** Civic number and street name: "123 rue Principale". */
  street?: string;
  unit?: string;
  city?: string;
  province?: string;
  postalCode?: string;
};

export type ServiceAddress = {
  street: string;
  unit?: string;
  city: string;
  province: string;
  postalCode?: string;
  country: "CA";
  /** One line, safe to store in `serviceAddress` and to read back to the caller. */
  formatted: string;
};

export type AddressCheck =
  | {
      status: "complete";
      address: ServiceAddress;
      /** Not required to book, but worth asking for when the caller can give it. */
      recommended: AddressField[];
    }
  | {
      status: "incomplete";
      missing: AddressField[];
      partial: Partial<ServiceAddress>;
    }
  | {
      status: "invalid";
      problem:
        | "po_box"
        | "invalid_postal_code"
        | "postal_province_mismatch"
        | "unsupported_province"
        | "too_long";
      field: AddressField;
    };

const MAX_STREET = 120;
const MAX_CITY = 80;
const MAX_UNIT = 20;
const MAX_FREE_TEXT = 300;

/** Canadian postal codes never use D, F, I, O, Q or U, and W/Z never lead. */
const POSTAL_RE =
  /\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])[\s-]?(\d[ABCEGHJ-NPRSTV-Z]\d)\b/i;

const POSTAL_PROVINCES: Record<string, readonly string[]> = {
  A: ["NL"],
  B: ["NS"],
  C: ["PE"],
  E: ["NB"],
  G: ["QC"],
  H: ["QC"],
  J: ["QC"],
  K: ["ON"],
  L: ["ON"],
  M: ["ON"],
  N: ["ON"],
  P: ["ON"],
  R: ["MB"],
  S: ["SK"],
  T: ["AB"],
  V: ["BC"],
  X: ["NT", "NU"],
  Y: ["YT"],
};

const PROVINCE_NAMES: Record<string, readonly string[]> = {
  AB: ["alberta"],
  BC: ["british columbia", "colombie britannique"],
  MB: ["manitoba"],
  NB: ["new brunswick", "nouveau brunswick"],
  NL: [
    "newfoundland and labrador",
    "newfoundland",
    "terre neuve et labrador",
    "terre neuve",
  ],
  NS: ["nova scotia", "nouvelle ecosse"],
  NT: ["northwest territories", "territoires du nord ouest"],
  NU: ["nunavut"],
  ON: ["ontario"],
  PE: ["prince edward island", "ile du prince edouard"],
  QC: ["quebec"],
  SK: ["saskatchewan"],
  YT: ["yukon"],
};

const PROVINCE_ALIASES: Record<string, string> = {
  PQ: "QC",
  NF: "NL",
  PEI: "PE",
  IPE: "PE",
};

const PROVINCE_CODES = new Set(Object.keys(PROVINCE_NAMES));

// "ste" is left out on purpose: "rue Ste Catherine" is a saint, not a suite.
const UNIT_WORDS = "apt|app|appartement|apartment|unit|unite|suite|bureau|bur|local";
const UNIT_RE = new RegExp(
  `(?:\\b(?:${UNIT_WORDS})\\b\\.?\\s*#?\\s*|#\\s*)(\\d{1,5}[A-Za-z]?\\b|[A-Za-z]\\b)`,
  "i",
);
const PO_BOX_RE = /\b(?:p\.?\s?o\.?\s*box|c\.?\s?p\.?\s*\d|case\s+postale|postal\s+box)\b/i;

export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function plain(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "QC", "qc", "Québec", "Quebec" -> "QC"; anything else -> undefined. */
export function provinceCode(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const upper = stripAccents(value).trim().toUpperCase().replace(/\./g, "");
  if (PROVINCE_CODES.has(upper)) return upper;
  if (Object.hasOwn(PROVINCE_ALIASES, upper)) return PROVINCE_ALIASES[upper];
  const name = plain(value);
  for (const [code, names] of Object.entries(PROVINCE_NAMES)) {
    if (names.includes(name)) return code;
  }
  return undefined;
}

function compactPostal(value: string): string | undefined {
  const match = POSTAL_RE.exec(value.trim());
  if (!match) return undefined;
  // The whole input must be the postal code, not merely contain one.
  if (value.trim().replace(/[\s-]/g, "").length !== 6) return undefined;
  return `${match[1]}${match[2]}`.toUpperCase();
}

function formatPostal(compact: string): string {
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

function tidyWords(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  // All-lower or all-upper speech-to-text output reads badly; leave mixed case alone.
  if (collapsed === collapsed.toLowerCase() || collapsed === collapsed.toUpperCase()) {
    return collapsed
      .replace(/(^|[\s'\u2019-])(\p{L})(\p{L}*)/gu, (_m, sep: string, first: string, rest: string) => {
        const lower = `${first}${rest}`.toLowerCase();
        // Keep small joining words in French and English lower-case.
        if (sep !== "" && /^(de|du|des|la|le|les|d|l|of|the)$/.test(lower)) return `${sep}${lower}`;
        return `${sep}${first.toUpperCase()}${rest.toLowerCase()}`;
      })
      // "12a main" -> "12A Main"
      .replace(/^(\d+)([a-z])\b/, (_m, digits: string, letter: string) => `${digits}${letter.toUpperCase()}`);
  }
  return collapsed;
}

type Parts = {
  street?: string;
  unit?: string;
  city?: string;
  province?: string;
  postal?: string;
};

function pullUnit(text: string): { rest: string; unit?: string } {
  // Quebec style: "4-123 rue X" is apartment 4 at civic number 123.
  const prefixed = /^(\d{1,5}[A-Za-z]?)\s*-\s*(\d{1,6}[A-Za-z]?\s+\S.*)$/.exec(text.trim());
  if (prefixed) return { unit: prefixed[1], rest: prefixed[2] };
  const match = UNIT_RE.exec(text);
  if (!match) return { rest: text.trim() };
  const rest = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`
    .replace(/\s+/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "");
  return { rest, unit: match[1] };
}

/** Removes a trailing province name or code from `part`; returns what remains. */
function pullProvince(part: string): { rest: string; province?: string } {
  const words = part.trim().split(/\s+/);
  for (let take = Math.min(4, words.length); take >= 1; take -= 1) {
    const tail = words.slice(-take).join(" ");
    const code = provinceCode(tail);
    if (!code) continue;
    // A bare two or three letter token only counts when it is upper-case as
    // written ("QC"); a lower-case "on" or "pe" is just a word.
    const bare = tail.replace(/\./g, "");
    if (take === 1 && /^[A-Za-z]{2,3}$/.test(bare) && bare !== bare.toUpperCase()) continue;
    return { rest: words.slice(0, -take).join(" "), province: code };
  }
  return { rest: part.trim() };
}

function parseFreeText(text: string): Parts {
  let work = text.replace(/\s+/g, " ").trim();
  const parts: Parts = {};
  const postal = POSTAL_RE.exec(work);
  if (postal) {
    parts.postal = `${postal[1]}${postal[2]}`.toUpperCase();
    work = `${work.slice(0, postal.index)} ${work.slice(postal.index + postal[0].length)}`;
  }
  const pieces = work
    .split(/[,;\n]+/)
    .map((piece) => piece.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  // The province is the last thing said before the postal code.
  for (let i = pieces.length - 1; i >= Math.max(0, pieces.length - 2); i -= 1) {
    const { rest, province } = pullProvince(pieces[i]);
    if (province) {
      parts.province = province;
      // "123 rue X, Québec": with nothing else to be the city, Québec is both.
      if (!rest && i === 1 && pieces.length === 2 && plain(pieces[i]) === "quebec") break;
      if (rest) pieces[i] = rest;
      else pieces.splice(i, 1);
      break;
    }
  }
  if (pieces.length === 0) return parts;
  const first = pieces[0];
  const { rest, unit } = pullUnit(first);
  parts.street = rest || first;
  if (unit) parts.unit = unit;
  const others = pieces.slice(1);
  if (others.length > 0) {
    parts.city = others[others.length - 1];
    for (const middle of others.slice(0, -1)) {
      const found = pullUnit(middle);
      if (found.unit && !parts.unit) parts.unit = found.unit;
    }
  }
  return parts;
}

const CIVIC_RE = /^\d{1,6}[A-Za-z]?(?:\s*-\s*\d{1,6}[A-Za-z]?)?\s+\S/;

/**
 * Checks and canonicalises a service address. Never guesses a missing part:
 * the caller must say it, so a wrong city is asked about instead of booked.
 */
export function checkServiceAddress(input: AddressInput): AddressCheck {
  const free = input.address?.trim();
  if (free && free.length > MAX_FREE_TEXT) {
    return { status: "invalid", problem: "too_long", field: "street" };
  }
  const parsed = free ? parseFreeText(free) : {};
  const rawStreet = (input.street?.trim() || parsed.street || "").replace(/\s+/g, " ");
  let unit = input.unit?.trim() || parsed.unit;
  const rawCity = (input.city?.trim() || parsed.city || "").replace(/\s+/g, " ");
  const rawProvince = input.province?.trim() || parsed.province;
  const rawPostal = input.postalCode?.trim() || parsed.postal;

  if (
    rawStreet.length > MAX_STREET ||
    rawCity.length > MAX_CITY ||
    (unit?.length ?? 0) > MAX_UNIT
  ) {
    return { status: "invalid", problem: "too_long", field: "street" };
  }
  if (PO_BOX_RE.test(`${rawStreet} ${rawCity}`) || PO_BOX_RE.test(free ?? "")) {
    return { status: "invalid", problem: "po_box", field: "street" };
  }

  let postal: string | undefined;
  if (rawPostal) {
    postal = compactPostal(rawPostal);
    if (!postal) return { status: "invalid", problem: "invalid_postal_code", field: "postal_code" };
  }
  let province: string | undefined;
  if (rawProvince) {
    province = provinceCode(rawProvince);
    if (!province) return { status: "invalid", problem: "unsupported_province", field: "province" };
  }
  if (postal) {
    const allowed = POSTAL_PROVINCES[postal[0]] ?? [];
    if (province && !allowed.includes(province)) {
      return { status: "invalid", problem: "postal_province_mismatch", field: "postal_code" };
    }
    // One province owns this letter: the postal code answers the question.
    if (!province && allowed.length === 1) province = allowed[0];
  }

  let street = rawStreet;
  if (street) {
    const split = pullUnit(street);
    if (split.unit && !unit) unit = split.unit;
    if (split.unit) street = split.rest;
  }
  const missing: AddressField[] = [];
  if (!street) {
    missing.push("street_number", "street");
  } else if (!CIVIC_RE.test(street)) {
    // Either no civic number ("rue Principale") or only a number ("123").
    missing.push(/^\d+$/.test(street) ? "street" : "street_number");
  }
  if (!rawCity) missing.push("city");
  if (!province) missing.push("province");

  const city = rawCity ? tidyWords(rawCity) : "";
  const partial: Partial<ServiceAddress> = {
    ...(street ? { street: tidyWords(street) } : {}),
    ...(unit ? { unit: unit.toUpperCase() } : {}),
    ...(city ? { city } : {}),
    ...(province ? { province } : {}),
    ...(postal ? { postalCode: formatPostal(postal) } : {}),
    country: "CA",
  };
  if (missing.length > 0) return { status: "incomplete", missing, partial };

  const address: ServiceAddress = {
    street: tidyWords(street),
    ...(unit ? { unit: unit.toUpperCase() } : {}),
    city,
    province: province as string,
    ...(postal ? { postalCode: formatPostal(postal) } : {}),
    country: "CA",
    formatted: "",
  };
  address.formatted = [
    address.street,
    address.unit ? `#${address.unit}` : undefined,
    address.city,
    `${address.province}${address.postalCode ? ` ${address.postalCode}` : ""}`,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    status: "complete",
    address,
    recommended: postal ? [] : ["postal_code"],
  };
}

const STREET_TOKENS: Record<string, string> = {
  street: "st",
  avenue: "av",
  ave: "av",
  boulevard: "blvd",
  boul: "blvd",
  bd: "blvd",
  road: "rd",
  drive: "dr",
  chemin: "ch",
  lane: "ln",
  court: "ct",
  crescent: "cres",
  place: "pl",
  terrace: "terr",
  route: "rte",
  montee: "mt",
  impasse: "imp",
  rang: "rg",
  north: "n",
  nord: "n",
  south: "s",
  sud: "s",
  east: "e",
  est: "e",
  west: "w",
  ouest: "w",
  apt: "u",
  app: "u",
  appartement: "u",
  apartment: "u",
  unit: "u",
  unite: "u",
  suite: "u",
  bureau: "u",
  bur: "u",
  local: "u",
  canada: "",
};

type LooseKey = { core: string; postal?: string };

function looseKey(text: string): LooseKey {
  let work = stripAccents(text);
  let postal: string | undefined;
  const match = POSTAL_RE.exec(work);
  if (match) {
    postal = `${match[1]}${match[2]}`.toUpperCase();
    work = `${work.slice(0, match.index)} ${work.slice(match.index + match[0].length)}`;
  }
  const tokens = work
    .toLowerCase()
    .replace(/#/g, " u ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    // "app 4" and "#4" and "unit 4" are one thing.
    .map((token) => (Object.hasOwn(STREET_TOKENS, token) ? STREET_TOKENS[token] : token))
    .filter(Boolean);
  // Drop a trailing province code or name: the street and city decide "same place".
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1].toUpperCase();
    if (PROVINCE_CODES.has(last) || Object.hasOwn(PROVINCE_ALIASES, last)) tokens.pop();
    else break;
  }
  return { core: tokens.join(" "), postal };
}

/** Same physical place, ignoring case, accents, punctuation and street-type spelling. */
export function addressesMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  const left = looseKey(a);
  const right = looseKey(b);
  if (left.core !== right.core) return false;
  return !left.postal || !right.postal || left.postal === right.postal;
}
