import { NextRequest } from "next/server";
import { validateTwilioSignature } from "./twilio";

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production";
}

/**
 * Validate Twilio webhook authenticity.
 *
 * Production: require TWILIO_AUTH_TOKEN and a valid X-Twilio-Signature.
 * MISSED_CALL_SKIP_TWILIO_VALIDATE is ignored in production (logged).
 *
 * Development: allow through when token is unset or skip flag is set.
 */
export async function assertTwilioWebhook(
  request: NextRequest,
  params: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  const skipFlag = env.MISSED_CALL_SKIP_TWILIO_VALIDATE === "1";

  if (isProduction(env)) {
    if (skipFlag) {
      console.error(
        "[twilio] MISSED_CALL_SKIP_TWILIO_VALIDATE=1 is ignored in production",
      );
    }
    if (!token) {
      console.error(
        "[twilio] refusing webhook — TWILIO_AUTH_TOKEN missing in production",
      );
      return false;
    }
  } else if (!token || skipFlag) {
    return true;
  }

  if (!token) return false;

  const signature = request.headers.get("x-twilio-signature") ?? "";
  if (!signature) return false;

  const url = env.MISSED_CALL_PUBLIC_WEBHOOK_BASE
    ? `${env.MISSED_CALL_PUBLIC_WEBHOOK_BASE.replace(/\/$/, "")}${request.nextUrl.pathname}`
    : request.url;

  return validateTwilioSignature({
    authToken: token,
    signature,
    url,
    params,
  });
}
