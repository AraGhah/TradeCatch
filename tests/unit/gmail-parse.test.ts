import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeEntities,
  decodeMimeWords,
  htmlToText,
  looksLikePerson,
  MAX_BODY_CHARS,
  parseAddress,
  parseGmailMessage,
  placementFor,
  type GmailApiMessage,
} from "../../src/product/gmail/parse";

const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");
const word = (text: string, charset = "UTF-8") => `=?${charset}?B?${Buffer.from(text).toString("base64")}?=`;

function raw(overrides: Partial<GmailApiMessage> & { headers?: { name: string; value: string }[]; parts?: unknown[] } = {}): GmailApiMessage {
  const { headers, parts, ...rest } = overrides;
  return {
    id: "m1",
    threadId: "t1",
    labelIds: ["INBOX", "UNREAD"],
    snippet: "Hello",
    internalDate: String(Date.UTC(2026, 9, 1, 12)),
    payload: {
      mimeType: "multipart/alternative",
      headers: headers ?? [
        { name: "From", value: '"Marie Tremblay" <marie@example.com>' },
        { name: "Subject", value: "Quote request" },
      ],
      body: {},
      parts: (parts as never) ?? [
        { partId: "0", mimeType: "text/plain", body: { data: b64("Plain body") } },
        { partId: "1", mimeType: "text/html", body: { data: b64("<p>HTML body</p>") } },
      ],
    },
    ...rest,
  };
}

describe("gmail message parsing", () => {
  it("prefers the plain-text part and reads sender, subject, date and unread flag", () => {
    const parsed = parseGmailMessage(raw(), "owner@gmail.com")!;
    assert.equal(parsed.bodyText, "Plain body");
    assert.equal(parsed.fromName, "Marie Tremblay");
    assert.equal(parsed.fromEmail, "marie@example.com");
    assert.equal(parsed.subject, "Quote request");
    assert.equal(parsed.receivedAt, "2026-10-01T12:00:00.000Z");
    assert.equal(parsed.unread, true);
    assert.equal(parsed.direction, "inbound");
    assert.equal(parsed.important, true);
  });

  it("falls back to readable text for HTML-only mail", () => {
    const html =
      "<html><head><style>p{color:red}</style></head><body><p>Bonjour&nbsp;Marie</p><p>Caf&eacute; &amp; cr&egrave;me</p><script>alert(1)</script><br>Fin</body></html>";
    const parsed = parseGmailMessage(
      raw({ parts: [{ partId: "0", mimeType: "text/html", body: { data: b64(html) } }] }),
    )!;
    assert.equal(parsed.bodyText, "Bonjour Marie\n\nCafé & crème\n\nFin");
    assert.ok(!parsed.bodyText!.includes("alert"));
    assert.ok(!parsed.bodyText!.includes("color:red"));
  });

  it("decodes ISO-8859-1 bodies instead of printing mojibake", () => {
    const latin1 = Buffer.from("Dépôt reçu à Montréal", "latin1");
    const parsed = parseGmailMessage(
      raw({
        parts: [
          {
            partId: "0",
            mimeType: "text/plain",
            headers: [{ name: "Content-Type", value: 'text/plain; charset="ISO-8859-1"' }],
            body: { data: b64(latin1) },
          },
        ],
      }),
    )!;
    assert.equal(parsed.bodyText, "Dépôt reçu à Montréal");
  });

  it("decodes RFC 2047 encoded subjects and sender names", () => {
    assert.equal(decodeMimeWords(word("Québec")), "Québec");
    assert.equal(decodeMimeWords("=?ISO-8859-1?Q?Cr=E8me_br=FBl=E9e?="), "Crème brûlée");
    assert.equal(decodeMimeWords(`${word("Hél")} ${word("ène")}`), "Hélène");
    assert.equal(decodeMimeWords("plain text"), "plain text");
    assert.deepEqual(parseAddress(`${word("Hélène")} <helene@example.com>`), {
      name: "Hélène",
      email: "helene@example.com",
    });
  });

  it("handles quoted display names with commas and bare addresses", () => {
    assert.deepEqual(parseAddress('"Doe, John" <john@example.com>'), { name: "Doe, John", email: "john@example.com" });
    assert.deepEqual(parseAddress("<only@example.com>"), { name: null, email: "only@example.com" });
    assert.deepEqual(parseAddress("bare@example.com"), { name: null, email: "bare@example.com" });
  });

  it("decodes entities in a single pass and survives malformed ones", () => {
    assert.equal(decodeEntities("Don&#39;t &amp;lt; &#x41; &bogus; &#99999999999;"), "Don't &lt; A &bogus; &#99999999999;");
  });

  it("decodes the HTML-escaped snippet Gmail returns", () => {
    const parsed = parseGmailMessage(raw({ snippet: "Don&#39;t forget &amp; call" }))!;
    assert.equal(parsed.snippet, "Don't forget & call");
  });

  it("lists attachments but not inline signature images", () => {
    const parsed = parseGmailMessage(
      raw({
        parts: [
          { partId: "0", mimeType: "text/plain", body: { data: b64("see attached") } },
          {
            partId: "1",
            mimeType: "application/pdf",
            filename: word("Soumission.pdf"),
            body: { attachmentId: "att-1", size: 2048 },
          },
          {
            partId: "2",
            mimeType: "image/png",
            filename: "logo.png",
            headers: [{ name: "Content-ID", value: "<logo>" }],
            body: { attachmentId: "att-2", size: 10 },
          },
        ],
      }),
    )!;
    assert.equal(parsed.hasAttachments, true);
    assert.deepEqual(parsed.attachments, [
      { filename: "Soumission.pdf", mimeType: "application/pdf", size: 2048, attachmentId: "att-1", partId: "1" },
    ]);
  });

  it("never stores drafts, spam, trash or mail with no inbox/sent label", () => {
    for (const labels of [["DRAFT"], ["SPAM"], ["TRASH", "INBOX"], ["CATEGORY_PROMOTIONS"], []]) {
      assert.equal(parseGmailMessage(raw({ labelIds: labels })), null, labels.join());
    }
    assert.equal(placementFor(["SENT"]), "outbound");
    assert.equal(placementFor(["INBOX"]), "inbound");
  });

  it("treats sent mail as outbound, read, and never as a customer email", () => {
    const parsed = parseGmailMessage(raw({ labelIds: ["SENT", "UNREAD"] }), "owner@gmail.com")!;
    assert.equal(parsed.direction, "outbound");
    assert.equal(parsed.unread, false);
    assert.equal(parsed.important, false);
  });

  it("keeps an empty subject empty so the UI can localise the placeholder", () => {
    const parsed = parseGmailMessage(raw({ headers: [{ name: "From", value: "a@b.co" }] }))!;
    assert.equal(parsed.subject, "");
  });

  it("caps very large bodies", () => {
    const parsed = parseGmailMessage(
      raw({ parts: [{ partId: "0", mimeType: "text/plain", body: { data: b64("x".repeat(MAX_BODY_CHARS * 2)) } }] }),
    )!;
    assert.equal(parsed.bodyText!.length, MAX_BODY_CHARS);
  });

  it("strips hostile HTML in linear time", () => {
    const started = Date.now();
    htmlToText("<style".repeat(200_000));
    htmlToText("<".repeat(300_000));
    htmlToText("<script>".repeat(100_000));
    htmlToText("<!--".repeat(100_000));
    assert.ok(Date.now() - started < 2000, "hostile markup must not stall a sync");
  });
});

describe("customer-email heuristic", () => {
  const base = { fromEmail: "marie@example.com", mailbox: "owner@gmail.com", labelIds: ["INBOX"] };
  it("accepts a person writing in", () => {
    assert.equal(looksLikePerson(base), true);
  });
  it("rejects our own address, robots and bulk mail", () => {
    assert.equal(looksLikePerson({ ...base, fromEmail: "Owner@Gmail.com" }), false);
    assert.equal(looksLikePerson({ ...base, fromEmail: "noreply@shop.com" }), false);
    assert.equal(looksLikePerson({ ...base, fromEmail: "no-reply@shop.com" }), false);
    assert.equal(looksLikePerson({ ...base, fromEmail: "mailer-daemon@googlemail.com" }), false);
    assert.equal(looksLikePerson({ ...base, labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] }), false);
    assert.equal(looksLikePerson({ ...base, headers: [{ name: "List-Unsubscribe", value: "<mailto:x@y>" }] }), false);
    assert.equal(looksLikePerson({ ...base, headers: [{ name: "Precedence", value: "bulk" }] }), false);
    assert.equal(looksLikePerson({ ...base, headers: [{ name: "Auto-Submitted", value: "auto-replied" }] }), false);
  });
  it("does not mistake a person whose name merely contains 'notification'", () => {
    assert.equal(looksLikePerson({ ...base, fromEmail: "notificationsmith@example.com" }), true);
  });
});
