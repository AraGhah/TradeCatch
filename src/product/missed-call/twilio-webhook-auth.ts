import { NextRequest, NextResponse } from "next/server";
import { isRealProductionRuntime } from "@/lib/environment";
import { BodyTooLargeError, readFormParamsBounded } from "@/lib/request-body";
import { validateTwilioSignature } from "./twilio";

/** Twilio status and voice callbacks are a few KB; this is the usual cap. */
export const TWILIO_FORM_MAX_BYTES = 32_768;

export type VerifiedTwilioForm =
  | { ok: true; params: Record<string, string> }
  | { ok: false; response: NextResponse };

/**
 * The shared webhook prelude: read a bounded form post, then verify the
 * Twilio signature. On failure `response` is what these webhooks have always
 * answered: 413 "Payload too large", 400 "Invalid form", 403 "Invalid
 * signature" (pinned by tests/unit/twilio-webhook-prelude.test.ts).
 */
export async function readVerifiedTwilioForm(
  request: NextRequest,
  maxBytes: number = TWILIO_FORM_MAX_BYTES,
): Promise<VerifiedTwilioForm> {
  let params: Record<string, string>;
  try {
    params = await readFormParamsBounded(request, maxBytes);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Payload too large" },
          { status: 413 },
        ),
      };
    }
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid form" }, { status: 400 }),
    };
  }
  if (!(await assertTwilioWebhook(request, params))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid signature" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, params };
}

/**
 * Validate Twilio webhook authenticity.
 *
 * Live production: require TWILIO_AUTH_TOKEN and a valid X-Twilio-Signature.
 * MISSED_CALL_SKIP_TWILIO_VALIDATE is ignored on live production (logged).
 *
 * Staging / development: allow through when token is unset or skip flag is set
 * so sandbox-driven simulations work without a real Twilio account.
 */
export async function assertTwilioWebhook(
  request: NextRequest,
  params: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  const skipFlag = env.MISSED_CALL_SKIP_TWILIO_VALIDATE === "1";
  const realProduction = isRealProductionRuntime(env);

  if (realProduction) {
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

  // Twilio signs the full URL including query string. Rebuild from the public
  // base + pathname + search so reverse-proxy host rewrites still verify.
  const url = env.MISSED_CALL_PUBLIC_WEBHOOK_BASE
    ? `${env.MISSED_CALL_PUBLIC_WEBHOOK_BASE.replace(/\/$/, "")}${request.nextUrl.pathname}${request.nextUrl.search}`
    : request.url;

  return validateTwilioSignature({
    authToken: token,
    signature,
    url,
    params,
  });
}
