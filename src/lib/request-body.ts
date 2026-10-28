/**
 * Bounded request-body readers for endpoints anyone on the internet can call.
 * `request.json()` / `request.text()` buffer whatever arrives, so a single
 * oversized request costs memory before any validation or signature check runs.
 */

export class BodyTooLargeError extends Error {
  constructor() {
    super("Payload too large");
    this.name = "BodyTooLargeError";
  }
}

/** True when the client already declared a body bigger than `maxBytes`. */
export function contentLengthExceeds(
  request: Request,
  maxBytes: number,
): boolean {
  const declared = Number(request.headers.get("content-length"));
  return Number.isFinite(declared) && declared > maxBytes;
}

/**
 * Reads the body as text, stopping as soon as `maxBytes` is crossed. The
 * declared Content-Length is checked first, but the stream is counted as well
 * because the header is absent on chunked uploads and can be wrong.
 */
export async function readBodyText(
  request: Request,
  maxBytes: number,
): Promise<string> {
  if (contentLengthExceeds(request, maxBytes)) throw new BodyTooLargeError();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * Bounded replacement for `await request.formData()` for Twilio webhooks,
 * which always POST `application/x-www-form-urlencoded` (never multipart).
 * `request.formData()` buffers the whole body with no size limit — exactly
 * the same unbounded-read risk `readBodyText` exists to close, and one the
 * proxy's declared-Content-Length check can't catch on a chunked request.
 * Parsing bounded text as URLSearchParams gets the same `Record<string,
 * string>` shape without ever going through the unbounded API.
 */
export async function readFormParamsBounded(
  request: Request,
  maxBytes: number,
): Promise<Record<string, string>> {
  const text = await readBodyText(request, maxBytes);
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) {
    params[k] = v;
  }
  return params;
}

export type JsonBody =
  { ok: true; data: unknown } | { ok: false; status: 400 | 413; error: string };

/** Bounded replacement for `await request.json()` that reports instead of throwing. */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<JsonBody> {
  let text: string;
  try {
    text = await readBodyText(request, maxBytes);
  } catch (error) {
    if (error instanceof BodyTooLargeError)
      return { ok: false, status: 413, error: "Payload too large." };
    return { ok: false, status: 400, error: "Invalid JSON." };
  }
  try {
    return { ok: true, data: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON." };
  }
}
