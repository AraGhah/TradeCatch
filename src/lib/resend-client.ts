import { Resend } from "resend";

let client: Resend | null = null;

/**
 * The process-wide Resend client, or null when RESEND_API_KEY is unset.
 * Callers treat null as "email not configured" and never claim a send.
 */
export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Resend(apiKey);
  return client;
}
