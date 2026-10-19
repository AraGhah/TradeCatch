import { z } from "zod";

/**
 * Gmail `users.watch` notifications arrive as a Pub/Sub push:
 * `{ message: { data: base64(JSON {emailAddress, historyId}) } }`.
 * Both layers are checked before anything reaches the database, so a stray or
 * hostile body can only ever be ignored.
 */
const envelope = z.object({
  message: z.object({ data: z.string().min(1).max(4096) }),
});

const notification = z.object({
  emailAddress: z.string().trim().min(3).max(254).email(),
  historyId: z.union([z.string().regex(/^\d{1,20}$/), z.number().int().nonnegative().safe()]).optional(),
});

export type GmailPushNotification = { email: string; historyId?: string };

// Pub/Sub uses standard base64; a hand-built request may use the URL-safe alphabet.
const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

export function parseGmailPush(body: unknown): GmailPushNotification | null {
  const wrapped = envelope.safeParse(body);
  if (!wrapped.success) return null;
  const data = wrapped.data.message.data;
  if (!BASE64.test(data)) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = notification.safeParse(decoded);
  if (!parsed.success) return null;
  return {
    email: parsed.data.emailAddress,
    historyId: parsed.data.historyId === undefined ? undefined : String(parsed.data.historyId),
  };
}
