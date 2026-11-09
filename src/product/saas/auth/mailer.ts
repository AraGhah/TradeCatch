import { Resend } from "resend";
import { isE2eHarness, isProductionRuntime } from "@/lib/config";

/**
 * Whether a single-use token may be handed back in the API response so a local
 * or test run can finish a flow without a mailbox. Never true in production
 * outside the explicit end-to-end harness.
 */
export function devTokenAllowed(emailSent: boolean): boolean {
  return (
    (process.env.SAAS_DEV_LOGIN === "1" ||
      (!isProductionRuntime() && !emailSent)) &&
    (!isProductionRuntime() || isE2eHarness())
  );
}

/**
 * Sends a plain-text account email (sign-in, activation, password reset).
 * Returns an error instead of throwing so callers can stay enumeration-safe.
 * Nothing sensitive other than the single-use link is ever put in these emails:
 * never a password.
 */
export async function sendAuthEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) return { ok: false, error: "Email is not configured." };
  try {
    const result = await new Resend(apiKey).emails.send({ from, ...input });
    return result.error
      ? { ok: false, error: result.error.message }
      : { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "send failed",
    };
  }
}
