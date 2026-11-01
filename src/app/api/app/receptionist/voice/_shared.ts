import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit-response";
import type { VoiceError } from "@/product/receptionist/custom-voice/model";
import type { VoiceActor } from "@/product/receptionist/custom-voice/service";
import {
  requireTenantContext,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import type { MemberRole } from "@/product/saas/types";

export const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: noStore });

const STATUS: Record<VoiceError, number> = {
  not_entitled: 403,
  unavailable: 503,
  consent_required: 400,
  consent_outdated: 400,
  challenge_invalid: 400,
  challenge_expired: 400,
  challenge_reused: 409,
  challenge_failed: 422,
  sample_invalid: 400,
  sample_too_short: 400,
  no_voice: 409,
  not_previewed: 409,
  consent_revoked: 409,
  provider_error: 502,
};

/**
 * The browser gets a stable `code` (the dashboard maps it to a localized
 * message) and nothing the provider said. A plan problem also says where to
 * upgrade.
 */
export function voiceErrorResponse(error: VoiceError) {
  return reply(
    {
      error: "The request could not be completed.",
      code: error,
      ...(error === "not_entitled" ? { upgrade: "receptionist" } : {}),
    },
    STATUS[error],
  );
}

/**
 * The signed-in caller's own business: the organization and plan always come
 * from the session, never from the request.
 *
 * This only identifies the caller. Every route that CHANGES something must
 * then make its own role decision with `forbiddenUnless(auth.role,
 * "manage_ai")` (owner/administrator, no platform-administrator override: the
 * consent has to come from the business itself).
 */
export async function requireVoiceActor(): Promise<
  | { ok: true; actor: VoiceActor; role: MemberRole }
  | { ok: false; response: Response }
> {
  const auth = await requireTenantContext();
  if (!auth.ok)
    return { ok: false, response: unauthorizedTenantResponse(auth.error) };
  const { organization, membership, user } = auth.ctx;
  return {
    ok: true,
    role: membership.role,
    actor: {
      organizationId: organization.id,
      plan: organization.plan,
      userId: user.id,
    },
  };
}

/** Spends one request from this user's budget for `scope`; a 429 response when it is used up. */
export function limitVoice(
  actor: VoiceActor,
  scope: string,
  limit: number,
  windowMs: number,
) {
  return enforceRateLimit({
    scope,
    subject: `${actor.organizationId}:${actor.userId}`,
    limit,
    windowMs,
  });
}
