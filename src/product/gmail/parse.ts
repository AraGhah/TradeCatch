import type {
  GmailAttachment,
  GmailDirection,
  ParsedGmailMessage,
} from "./types";

export type GmailHeader = { name?: string; value?: string };
export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailApiMessage = {
  id?: string;
  threadId?: string;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPart;
};

export const MAX_BODY_CHARS = 100_000;
const MAX_HTML_CHARS = 400_000;
const MAX_PARTS = 400;

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  euml: "ë",
  agrave: "à",
  acirc: "â",
  ccedil: "ç",
  ocirc: "ô",
  ugrave: "ù",
  ucirc: "û",
  icirc: "î",
  iuml: "ï",
  Eacute: "É",
  Egrave: "È",
  Agrave: "À",
  Ccedil: "Ç",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  euro: "€",
  copy: "©",
  reg: "®",
  deg: "°",
};

/** Single pass, so `&amp;lt;` correctly becomes `&lt;` and not `<`. */
export function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi,
    (whole, entity: string) => {
      if (entity.startsWith("#")) {
        const hex = entity[1]?.toLowerCase() === "x";
        const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return whole;
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      return NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
    },
  );
}

const SKIPPED_TAGS = new Set(["style", "script", "head", "title"]);
const BREAK_TAGS = new Set([
  "br",
  "p",
  "div",
  "li",
  "tr",
  "table",
  "ul",
  "ol",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

/**
 * One linear scan with indexOf, never a backtracking regex: the input is
 * attacker-controlled mail and runs on the server at sync time.
 */
export function htmlToText(html: string): string {
  const input = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
  // ASCII-only lowercasing keeps indexes aligned with `input`.
  const lower = input.replace(/[A-Z]/g, (char) => char.toLowerCase());
  let out = "";
  let i = 0;
  while (i < input.length) {
    const open = input.indexOf("<", i);
    if (open === -1) {
      out += input.slice(i);
      break;
    }
    out += input.slice(i, open);
    if (lower.startsWith("<!--", open)) {
      const end = lower.indexOf("-->", open + 4);
      i = end === -1 ? input.length : end + 3;
      continue;
    }
    const close = input.indexOf(">", open + 1);
    if (close === -1) {
      out += input.slice(open);
      break;
    }
    const tag = lower.slice(open + 1, close);
    const name = /^\/?([a-z][a-z0-9]*)/.exec(tag)?.[1];
    i = close + 1;
    if (!name) continue;
    if (!tag.startsWith("/") && SKIPPED_TAGS.has(name)) {
      const end = lower.indexOf(`</${name}`, i);
      if (end === -1) break;
      const endClose = input.indexOf(">", end);
      i = endClose === -1 ? input.length : endClose + 1;
      continue;
    }
    if (BREAK_TAGS.has(name)) out += "\n";
  }
  return tidyText(decodeEntities(out));
}

function tidyText(value: string): string {
  return value
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeBytes(bytes: Uint8Array, charset: string | undefined): string {
  const label = (charset || "utf-8").trim().toLowerCase();
  try {
    return new TextDecoder(label === "utf8" ? "utf-8" : label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** RFC 2047 encoded-words, e.g. `=?UTF-8?B?...?=` or `=?ISO-8859-1?Q?...?=`. */
export function decodeMimeWords(value: string): string {
  if (!value.includes("=?")) return value;
  return value
    .replace(/(\?=)\s+(=\?)/g, "$1$2")
    .replace(
      /=\?([\w.-]+)(?:\*[\w-]+)?\?([bBqQ])\?([^?]*)\?=/g,
      (whole, charset: string, encoding: string, text: string) => {
        try {
          const bytes =
            encoding.toUpperCase() === "B"
              ? Buffer.from(text, "base64")
              : Buffer.from(
                  text
                    .replace(/_/g, " ")
                    .replace(/=([0-9a-f]{2})/gi, (_, hex: string) =>
                      String.fromCharCode(Number.parseInt(hex, 16)),
                    ),
                  "latin1",
                );
          return decodeBytes(bytes, charset);
        } catch {
          return whole;
        }
      },
    );
}

function header(headers: GmailHeader[] | undefined, name: string): string {
  const wanted = name.toLowerCase();
  const found = headers?.find((row) => row.name?.toLowerCase() === wanted);
  return found?.value?.trim() || "";
}

export function parseAddress(raw: string): { name: string | null; email: string } {
  const value = decodeMimeWords(raw).trim();
  const angle = value.lastIndexOf("<");
  const end = value.lastIndexOf(">");
  if (angle !== -1 && end > angle) {
    const email = value.slice(angle + 1, end).trim();
    const name = value
      .slice(0, angle)
      .replace(/^\s*"|"\s*$/g, "")
      .replace(/\\"/g, '"')
      .trim();
    return { name: name || null, email };
  }
  return { name: null, email: value };
}

function decodeBody(data: string | undefined, charset: string | undefined): string {
  if (!data) return "";
  try {
    return decodeBytes(Buffer.from(data, "base64url"), charset);
  } catch {
    return "";
  }
}

function charsetOf(part: GmailPart): string | undefined {
  const type = header(part.headers, "content-type");
  return /charset\s*=\s*"?([^";\s]+)/i.exec(type)?.[1];
}

type Walked = {
  text: string;
  html: string;
  attachments: GmailAttachment[];
  seen: number;
};

function walk(part: GmailPart | undefined, acc: Walked) {
  if (!part || acc.seen >= MAX_PARTS) return;
  acc.seen += 1;
  const filename = part.filename?.trim();
  const mimeType = (part.mimeType || "").toLowerCase();
  if (filename && part.body?.attachmentId) {
    const inlineImage =
      mimeType.startsWith("image/") && Boolean(header(part.headers, "content-id"));
    if (!inlineImage) {
      acc.attachments.push({
        filename: decodeMimeWords(filename),
        mimeType: part.mimeType || "application/octet-stream",
        size: part.body.size || 0,
        attachmentId: part.body.attachmentId,
        partId: part.partId || "",
      });
    }
  } else if (!filename) {
    if (mimeType === "text/plain" && !acc.text) {
      acc.text = decodeBody(part.body?.data, charsetOf(part));
    } else if (mimeType === "text/html" && !acc.html) {
      acc.html = decodeBody(part.body?.data, charsetOf(part));
    }
  }
  for (const child of part.parts || []) walk(child, acc);
}

export type MessagePlacement = GmailDirection | "ignore";

/** Where a message belongs. Drafts, spam and trash are never imported. */
export function placementFor(labelIds: string[] | undefined): MessagePlacement {
  const labels = new Set(labelIds || []);
  if (labels.has("DRAFT") || labels.has("SPAM") || labels.has("TRASH")) return "ignore";
  if (labels.has("INBOX")) return "inbound";
  if (labels.has("SENT")) return "outbound";
  return "ignore";
}

const BULK_CATEGORIES = [
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_FORUMS",
];

/**
 * True when a person plausibly wrote this mail: not our own address, not a
 * no-reply robot, not bulk/list mail, not a Gmail promo/social/forum category.
 */
export function looksLikePerson(input: {
  fromEmail: string;
  mailbox: string;
  headers?: GmailHeader[];
  labelIds?: string[];
}): boolean {
  const from = input.fromEmail.trim().toLowerCase();
  const own = input.mailbox.trim().toLowerCase();
  if (!from || from === own) return false;
  if (/(^|[._+-])(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounce[s]?)@/.test(from)) {
    return false;
  }
  if ((input.labelIds || []).some((label) => BULK_CATEGORIES.includes(label))) return false;
  const h = input.headers;
  if (header(h, "list-unsubscribe") || header(h, "list-id")) return false;
  if (/^(bulk|list|junk)$/i.test(header(h, "precedence"))) return false;
  const auto = header(h, "auto-submitted").toLowerCase();
  if (auto && auto !== "no") return false;
  return true;
}

/**
 * Returns null for messages that should not be stored (no id, draft, spam,
 * trash, or a label set that is neither inbox nor sent).
 */
export function parseGmailMessage(
  raw: GmailApiMessage,
  mailbox = "",
): ParsedGmailMessage | null {
  if (!raw.id || !raw.threadId) return null;
  const direction = placementFor(raw.labelIds);
  if (direction === "ignore") return null;
  const headers = raw.payload?.headers;
  const from = parseAddress(header(headers, "from") || "unknown@unknown");
  const walked: Walked = { text: "", html: "", attachments: [], seen: 0 };
  walk(raw.payload, walked);
  const snippet = decodeEntities(raw.snippet || "").trim();
  const body = walked.text.trim() || (walked.html ? htmlToText(walked.html) : "") || snippet;
  const receivedMs = Number(raw.internalDate);
  const fromEmail = from.email || "unknown@unknown";
  return {
    gmailId: raw.id,
    threadId: raw.threadId,
    fromName: from.name,
    fromEmail,
    subject: decodeMimeWords(header(headers, "subject")),
    snippet,
    bodyText: body ? body.slice(0, MAX_BODY_CHARS) : null,
    receivedAt: Number.isFinite(receivedMs)
      ? new Date(receivedMs).toISOString()
      : new Date(0).toISOString(),
    unread: direction === "inbound" && (raw.labelIds || []).includes("UNREAD"),
    hasAttachments: walked.attachments.length > 0,
    attachments: walked.attachments,
    important:
      direction === "inbound" &&
      looksLikePerson({ fromEmail, mailbox, headers, labelIds: raw.labelIds }),
    direction,
  };
}

export function newMessageIds(known: Set<string>, incoming: string[]): string[] {
  const seen = new Set<string>();
  const fresh: string[] = [];
  for (const id of incoming) {
    if (!id || known.has(id) || seen.has(id)) continue;
    seen.add(id);
    fresh.push(id);
  }
  return fresh;
}
