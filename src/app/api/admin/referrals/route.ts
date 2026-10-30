import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { isCrossSiteMutation } from "@/lib/csrf";
import { enforceRateLimit } from "@/lib/rate-limit-response";
import { readJsonBody } from "@/lib/request-body";
import { REFERRAL_CODE_PATTERN } from "@/product/referrals/code";
import { logReferralFailure } from "@/product/referrals/log";
import { getReferralService } from "@/product/referrals/runtime";
import type { DecisionError } from "@/product/referrals/service";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers });

async function access(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return { response: reply({ error: auth.error }, auth.status) };
  // Approving rewards and recording gift cards moves money: require an
  // individually identified MFA administrator, never the shared operations
  // secret or a customer organization's owner.
  if (auth.via !== "session" || !auth.ctx) {
    return {
      response: reply({ error: "An MFA-verified administrator session is required." }, 403),
    };
  }
  return { actor: auth.ctx.user.email };
}

const id = z.string().trim().min(1).max(80);
const commandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("approve"),
      rewardId: id,
      acknowledgeFlags: z.boolean().optional(),
      note: z.string().trim().max(500).optional(),
    })
    .strict(),
  z.object({ action: z.literal("reject"), rewardId: id, note: z.string().max(500) }).strict(),
  z
    .object({ action: z.literal("issue"), rewardId: id, giftCardReference: z.string().max(200) })
    .strict(),
  z.object({ action: z.literal("settings"), settings: z.unknown() }).strict(),
  z.object({ action: z.literal("reconcile") }).strict(),
  z
    .object({
      action: z.literal("link"),
      organizationId: id,
      code: z.string().trim().regex(REFERRAL_CODE_PATTERN),
    })
    .strict(),
]);

const STATUS_FOR_ERROR: Record<DecisionError, number> = {
  not_found: 404,
  invalid_note: 400,
  invalid_reference: 400,
  not_pending: 409,
  not_approved: 409,
  test_payment_not_approvable: 409,
  hold_period_active: 409,
  referred_inactive: 409,
  referrer_inactive: 409,
  referrer_is_demo: 409,
  payment_reversed: 409,
  flags_require_acknowledgement: 409,
  fulfillment_not_configured: 409,
  reference_already_used: 409,
  payment_unverified: 503,
};

export async function GET(request: Request) {
  const auth = await access(request);
  if (auth.response) return auth.response;
  try {
    const service = getReferralService();
    const rewardId = new URL(request.url).searchParams.get("rewardId");
    if (rewardId) {
      return reply({ ok: true, events: await service.listEvents({ rewardId, limit: 100 }) });
    }
    return reply({ ok: true, ...(await service.adminOverview()) });
  } catch {
    return reply({ error: "The referral program is unavailable." }, 503);
  }
}

export async function POST(request: Request) {
  if (
    isCrossSiteMutation({
      method: request.method,
      headers: request.headers,
      hosts: [new URL(request.url).host],
    })
  ) {
    return reply({ error: "Cross-site request blocked." }, 403);
  }
  const auth = await access(request);
  if (auth.response) return auth.response;
  const limited = await enforceRateLimit({
    scope: "referral-admin",
    subject: auth.actor!,
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const body = await readJsonBody(request, 8192);
  if (!body.ok) return reply({ error: body.error }, body.status);
  const parsed = commandSchema.safeParse(body.data);
  if (!parsed.success) return reply({ error: "Invalid referral request." }, 400);

  const command = parsed.data;
  const actor = auth.actor!;
  try {
    const service = getReferralService();
    switch (command.action) {
      case "approve": {
        const result = await service.approveReward(command.rewardId, actor, {
          acknowledgeFlags: command.acknowledgeFlags,
          note: command.note,
        });
        return result.ok
          ? reply({ ok: true, reward: result.reward })
          : reply(
              { error: result.error, eligibleAt: result.eligibleAt },
              STATUS_FOR_ERROR[result.error],
            );
      }
      case "reject": {
        const result = await service.rejectReward(command.rewardId, actor, command.note);
        return result.ok
          ? reply({ ok: true, reward: result.reward })
          : reply({ error: result.error }, STATUS_FOR_ERROR[result.error]);
      }
      case "issue": {
        const result = await service.markIssued(command.rewardId, actor, {
          giftCardReference: command.giftCardReference,
        });
        return result.ok
          ? reply({ ok: true, reward: result.reward })
          : reply({ error: result.error }, STATUS_FOR_ERROR[result.error]);
      }
      case "settings": {
        const result = await service.updateSettings(command.settings, actor);
        return result.ok
          ? reply({ ok: true, settings: result.settings })
          : reply({ error: result.error }, 400);
      }
      case "reconcile":
        return reply({ ok: true, ...(await service.reconcilePaidReferrals()) });
      case "link": {
        const result = await service.registerReferral({
          code: command.code,
          referredOrganizationId: command.organizationId,
          actor,
        });
        return result.ok
          ? reply({ ok: true, referral: result.referral }, 201)
          : reply({ error: result.reason, referral: result.referral }, 409);
      }
    }
  } catch (error) {
    logReferralFailure("admin action", error, { action: command.action });
    return reply({ error: "The change could not be saved. Nothing was recorded." }, 503);
  }
}
