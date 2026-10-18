/**
 * A small but faithful stand-in for the parts of Google the Gmail feature
 * talks to: the OAuth token/revoke endpoints and the Gmail REST API
 * (profile, messages, attachments, history, watch). It is shared by the unit
 * tests (as a `fetch`) and the Playwright run (behind a real HTTP server), so
 * both exercise the same behaviour, including history paging, label changes,
 * revoked grants, expired access tokens and rate limits.
 */

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

type Part = {
  partId: string;
  mimeType: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body: { data?: string; size?: number; attachmentId?: string };
  parts?: Part[];
};

export type FakeAttachment = { filename: string; mimeType?: string; content: string };

export type Deliver = {
  from: string;
  subject: string;
  text?: string;
  html?: string;
  /** Raw bytes for the text part, to exercise non-UTF-8 charsets. */
  textBytes?: Buffer;
  charset?: string;
  threadId?: string;
  labels?: string[];
  headers?: Record<string, string>;
  attachments?: FakeAttachment[];
  at?: Date;
  unread?: boolean;
};

type StoredMessage = {
  id: string;
  threadId: string;
  labels: Set<string>;
  internalDate: number;
  snippet: string;
  payload: Part;
  attachments: Map<string, string>;
};

type HistoryRecord = {
  id: string;
  messagesAdded?: { message: { id: string; threadId: string; labelIds: string[] } }[];
  messagesDeleted?: { message: { id: string; threadId: string } }[];
  labelsAdded?: { message: { id: string; threadId: string }; labelIds: string[] }[];
  labelsRemoved?: { message: { id: string; threadId: string }; labelIds: string[] }[];
};

const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");

export class FakeMailbox {
  readonly messages = new Map<string, StoredMessage>();
  readonly history: HistoryRecord[] = [];
  historyCounter = 1000;
  oldestHistory = 1000;
  revoked = false;
  /** Real Gmail may hand out a different attachmentId on every fetch of a message. */
  rotateAttachmentIds = false;
  private seq = 0;

  constructor(readonly email: string) {}

  private bump(): string {
    this.historyCounter += 1;
    return String(this.historyCounter);
  }

  get historyId(): string {
    return String(this.historyCounter);
  }

  deliver(input: Deliver): string {
    this.seq += 1;
    const id = `m${this.email.split("@")[0]}${this.seq.toString().padStart(4, "0")}`;
    const threadId = input.threadId ?? `t${id}`;
    const labels = new Set(input.labels ?? ["INBOX"]);
    if (input.unread !== false && labels.has("INBOX")) labels.add("UNREAD");
    const attachments = new Map<string, string>();
    const parts: Part[] = [];
    const charset = input.charset ?? "UTF-8";
    if (input.text !== undefined || input.textBytes) {
      parts.push({
        partId: "0",
        mimeType: "text/plain",
        headers: [{ name: "Content-Type", value: `text/plain; charset="${charset}"` }],
        body: { data: b64(input.textBytes ?? input.text ?? "") },
      });
    }
    if (input.html !== undefined) {
      parts.push({
        partId: "1",
        mimeType: "text/html",
        headers: [{ name: "Content-Type", value: 'text/html; charset="UTF-8"' }],
        body: { data: b64(input.html) },
      });
    }
    (input.attachments ?? []).forEach((file, index) => {
      const attachmentId = `att-${id}-${index}-${Math.random().toString(36).slice(2, 8)}`;
      attachments.set(`part:${index + 2}`, file.content);
      attachments.set(attachmentId, file.content);
      parts.push({
        partId: String(index + 2),
        mimeType: file.mimeType ?? "application/octet-stream",
        filename: file.filename,
        body: { attachmentId, size: Buffer.byteLength(file.content) },
      });
    });
    const headers = [
      { name: "From", value: input.from },
      { name: "Subject", value: input.subject },
      ...Object.entries(input.headers ?? {}).map(([name, value]) => ({ name, value })),
    ];
    const payload: Part =
      parts.length === 1 && !parts[0]!.filename
        ? { ...parts[0]!, partId: "", headers: [...headers, ...(parts[0]!.headers ?? [])] }
        : { partId: "", mimeType: "multipart/mixed", headers, body: {}, parts };
    const text = input.text ?? input.html?.replace(/<[^>]*>/g, " ") ?? "";
    const message: StoredMessage = {
      id,
      threadId,
      labels,
      internalDate: (input.at ?? new Date()).getTime(),
      // Real Gmail HTML-escapes the snippet.
      snippet: text.replace(/&/g, "&amp;").replace(/'/g, "&#39;").slice(0, 120),
      payload,
      attachments,
    };
    this.messages.set(id, message);
    this.history.push({
      id: this.bump(),
      messagesAdded: [{ message: { id, threadId, labelIds: [...labels] } }],
    });
    return id;
  }

  setUnread(id: string, unread: boolean) {
    const message = this.messages.get(id);
    if (!message) return;
    if (unread) message.labels.add("UNREAD");
    else message.labels.delete("UNREAD");
    const record: HistoryRecord = { id: this.bump() };
    const entry = { message: { id, threadId: message.threadId }, labelIds: ["UNREAD"] };
    if (unread) record.labelsAdded = [entry];
    else record.labelsRemoved = [entry];
    this.history.push(record);
  }

  trash(id: string) {
    const message = this.messages.get(id);
    if (!message) return;
    message.labels.add("TRASH");
    message.labels.delete("INBOX");
    this.history.push({
      id: this.bump(),
      labelsAdded: [{ message: { id, threadId: message.threadId }, labelIds: ["TRASH"] }],
    });
  }

  remove(id: string) {
    const message = this.messages.get(id);
    if (!message) return;
    this.messages.delete(id);
    this.history.push({
      id: this.bump(),
      messagesDeleted: [{ message: { id, threadId: message.threadId } }],
    });
  }

  /** Google forgets history older than about a week; later reads 404. */
  expireHistory() {
    this.oldestHistory = this.historyCounter + 1;
  }
}

export type CallRecord = { method: string; path: string; mailbox?: string };

export class FakeGoogle {
  readonly mailboxes = new Map<string, FakeMailbox>();
  readonly calls: CallRecord[] = [];
  readonly revokedTokens: string[] = [];
  /** Access token -> mailbox email, for tokens that are currently valid. */
  private valid = new Map<string, string>();
  private counter = 0;
  /** Queue of forced failures for the next Gmail API calls. */
  private failures: { status: number; body: unknown; headers?: Record<string, string> }[] = [];
  /** What the next visit to the consent screen does: approve for `email`, or cancel. */
  consent: { mode: "allow" | "deny"; email: string } = { mode: "allow", email: "" };
  /** Every consent-screen visit, so tests can assert on what was asked for. */
  readonly authRequests: { params: URLSearchParams; email: string }[] = [];
  grantScope: string | null = GMAIL_SCOPE;
  grantRefreshToken = true;
  historyPageSize: number | null = null;

  mailbox(email: string): FakeMailbox {
    let box = this.mailboxes.get(email);
    if (!box) {
      box = new FakeMailbox(email);
      this.mailboxes.set(email, box);
    }
    return box;
  }

  /** The `code` the consent screen would hand back for this mailbox. */
  codeFor(email: string): string {
    this.mailbox(email);
    return `code:${email}`;
  }

  /** Make every issued access token stop working (simulates expiry). */
  expireAccessTokens() {
    this.valid.clear();
  }

  failNext(status: number, body: unknown = {}, headers: Record<string, string> = {}, times = 1) {
    for (let i = 0; i < times; i += 1) this.failures.push({ status, body, headers });
  }

  count(match: string): number {
    return this.calls.filter((call) => `${call.method} ${call.path}`.includes(match)).length;
  }

  reset() {
    this.calls.length = 0;
  }

  private issue(email: string) {
    this.counter += 1;
    const token = `at:${email}:${this.counter}`;
    this.valid.set(token, email);
    return token;
  }

  private json(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  private gmailError(status: number, reason: string, message: string, headers?: Record<string, string>) {
    return this.json(
      status,
      { error: { code: status, message, errors: [{ reason, message }], status: reason.toUpperCase() } },
      headers,
    );
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    this.calls.push({ method: request.method, path });

    if (path === "/o/oauth2/v2/auth" && request.method === "GET") return this.consentScreen(url);
    if (path === "/token" && request.method === "POST") return this.token(await request.text());
    if (path === "/revoke" && request.method === "POST") {
      const form = new URLSearchParams(await request.text());
      const token = form.get("token") || "";
      this.revokedTokens.push(token);
      const email = token.replace(/^rt:/, "");
      const box = this.mailboxes.get(email);
      if (box) box.revoked = true;
      return this.json(200, {});
    }

    const prefix = "/gmail/v1/users/me";
    if (!path.startsWith(prefix)) return this.json(404, { error: "not found" });
    const auth = request.headers.get("authorization") || "";
    const email = this.valid.get(auth.replace(/^Bearer /, ""));
    if (!email) {
      return this.gmailError(401, "authError", "Request had invalid authentication credentials.");
    }
    this.calls[this.calls.length - 1]!.mailbox = email;
    const failure = this.failures.shift();
    if (failure) return this.json(failure.status, failure.body, failure.headers);
    const box = this.mailbox(email);
    const route = path.slice(prefix.length);

    if (route === "/profile") {
      return this.json(200, {
        emailAddress: email,
        historyId: box.historyId,
        messagesTotal: box.messages.size,
      });
    }
    if (route === "/messages" && request.method === "GET") return this.list(box, url);
    if (route === "/history") return this.historyList(box, url);
    if (route === "/watch" && request.method === "POST") {
      return this.json(200, { historyId: box.historyId, expiration: String(Date.now() + 7 * 864e5) });
    }
    if (route === "/stop" && request.method === "POST") return new Response(null, { status: 204 });
    const attachment = /^\/messages\/([^/]+)\/attachments\/(.+)$/.exec(route);
    if (attachment) {
      const message = box.messages.get(decodeURIComponent(attachment[1]!));
      const content = message?.attachments.get(decodeURIComponent(attachment[2]!));
      if (content === undefined) return this.gmailError(404, "notFound", "Attachment not found");
      return this.json(200, { size: Buffer.byteLength(content), data: b64(content) });
    }
    const one = /^\/messages\/([^/]+)$/.exec(route);
    if (one) {
      const message = box.messages.get(decodeURIComponent(one[1]!));
      if (!message) return this.gmailError(404, "notFound", "Requested entity was not found.");
      if (box.rotateAttachmentIds) {
        for (const part of message.payload.parts ?? []) {
          const old = part.body.attachmentId;
          if (!old) continue;
          const content = message.attachments.get(old)!;
          message.attachments.delete(old);
          part.body.attachmentId = `${old}r`;
          message.attachments.set(part.body.attachmentId, content);
        }
      }
      return this.json(200, {
        id: message.id,
        threadId: message.threadId,
        labelIds: [...message.labels],
        snippet: message.snippet,
        internalDate: String(message.internalDate),
        payload: message.payload,
      });
    }
    return this.json(404, { error: "unknown route" });
  }

  private consentScreen(url: URL): Response {
    const back = new URL(url.searchParams.get("redirect_uri") || "");
    this.authRequests.push({ params: url.searchParams, email: this.consent.email });
    back.searchParams.set("state", url.searchParams.get("state") || "");
    if (this.consent.mode === "allow") back.searchParams.set("code", this.codeFor(this.consent.email));
    else back.searchParams.set("error", "access_denied");
    return new Response(null, { status: 302, headers: { Location: back.toString() } });
  }

  /** The state value of the latest consent visit made while approving `email`. */
  lastStateFor(email: string): string {
    const found = [...this.authRequests].reverse().find((request) => request.email === email);
    return found?.params.get("state") || "";
  }

  private token(raw: string): Response {
    const form = new URLSearchParams(raw);
    const grant = form.get("grant_type");
    if (grant === "authorization_code") {
      const code = form.get("code") || "";
      if (!code.startsWith("code:")) {
        return this.json(400, { error: "invalid_grant", error_description: "Bad Request" });
      }
      const email = code.slice("code:".length);
      this.mailbox(email).revoked = false;
      return this.json(200, {
        access_token: this.issue(email),
        expires_in: 3600,
        ...(this.grantRefreshToken ? { refresh_token: `rt:${email}` } : {}),
        ...(this.grantScope ? { scope: this.grantScope } : {}),
        token_type: "Bearer",
      });
    }
    if (grant === "refresh_token") {
      const refresh = form.get("refresh_token") || "";
      const email = refresh.replace(/^rt:/, "");
      const box = this.mailboxes.get(email);
      if (!refresh.startsWith("rt:") || !box || box.revoked) {
        return this.json(400, {
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        });
      }
      return this.json(200, { access_token: this.issue(email), expires_in: 3600, scope: GMAIL_SCOPE });
    }
    return this.json(400, { error: "unsupported_grant_type" });
  }

  private list(box: FakeMailbox, url: URL): Response {
    const labels = url.searchParams.getAll("labelIds");
    const max = Number(url.searchParams.get("maxResults") || 100);
    const rows = [...box.messages.values()]
      .filter((message) => labels.every((label) => message.labels.has(label)))
      .sort((a, b) => b.internalDate - a.internalDate)
      .slice(0, max)
      .map((message) => ({ id: message.id, threadId: message.threadId }));
    return this.json(200, rows.length ? { messages: rows, resultSizeEstimate: rows.length } : { resultSizeEstimate: 0 });
  }

  private historyList(box: FakeMailbox, url: URL): Response {
    const start = Number(url.searchParams.get("startHistoryId"));
    if (!Number.isFinite(start) || start < box.oldestHistory - 1 || start > box.historyCounter) {
      return this.gmailError(404, "notFound", "Requested entity was not found.");
    }
    const size = this.historyPageSize ?? Number(url.searchParams.get("maxResults") || 100);
    const offset = Number(url.searchParams.get("pageToken") || 0);
    const types = url.searchParams.getAll("historyTypes");
    const all = box.history.filter((record) => Number(record.id) > start);
    const slice = all.slice(offset, offset + size).filter((record) => {
      if (types.length === 0) return true;
      return (
        (record.messagesAdded && types.includes("messageAdded")) ||
        (record.messagesDeleted && types.includes("messageDeleted")) ||
        (record.labelsAdded && types.includes("labelAdded")) ||
        (record.labelsRemoved && types.includes("labelRemoved"))
      );
    });
    const more = offset + size < all.length;
    return this.json(200, {
      ...(slice.length ? { history: slice } : {}),
      ...(more ? { nextPageToken: String(offset + size) } : {}),
      historyId: box.historyId,
    });
  }

  /** A `fetch` that talks to this fake instead of the network. */
  fetchImpl(): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input as string, init);
      return this.handle(request);
    }) as typeof fetch;
  }
}
