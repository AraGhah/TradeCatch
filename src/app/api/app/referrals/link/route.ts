import { NextResponse } from "next/server";
import { enforcePolicy } from "@/lib/rate-limit-response";
import { referralUrl } from "@/product/referrals/links";
import { logReferralFailure } from "@/product/referrals/log";
import { getReferralServiceReady } from "@/product/referrals/runtime";
import { forbiddenUnless } from "@/product/security/access";
import {
  requireTenantContext,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store, max-age=0" };
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers });

/** Why a link cannot be handed out, as the status the page reacts to. */
const REFUSAL_STATUS = {
  program_disabled: 409,
  organization_inactive: 409,
  no_paid_access: 409,
  storage_unavailable: 503,
} as const;

/**
 * The caller's OWN referral link. The business is always the signed-in
 * business: nothing in the URL or body can name another one, so one customer
 * can never read or create another customer's link. Rewards and payouts are a
 * billing matter, so only owners and administrators may use it.
 */
async function authorize() {
  const auth = await requireTenantContext();
  if (!auth.ok) return { response: unauthorizedTenantResponse(auth.error) };
  const { organization, membership, user, isPlatformAdmin } = auth.ctx;
  const forbidden = forbiddenUnless(
    membership.role,
    "manage_billing",
    isPlatformAdmin,
  );
  if (forbidden) return { response: forbidden };
  return { organization, user };
}

function linkBody(code: string, created: boolean) {
  return {
    ok: true as const,
    created,
    link: referralUrl(code, "en"),
    links: { en: referralUrl(code, "en"), fr: referralUrl(code, "fr") },
  };
}

/** The existing link, or `link: null` when the business has not asked for one yet. */
export async function GET() {
  const caller = await authorize();
  if (caller.response) return caller.response;
  try {
    const service = await getReferralServiceReady();
    const result = await service.getLink(caller.organization.id);
    if (!result.ok) {
      return reply({ error: result.reason }, REFUSAL_STATUS[result.reason]);
    }
    return reply(
      result.code ? linkBody(result.code, false) : { ok: true, link: null },
    );
  } catch (error) {
    logReferralFailure("link lookup", error);
    return reply({ error: "storage_unavailable" }, 503);
  }
}

/**
 * Get the business's link, creating it the first time. Safe to repeat: the
 * store keeps one code per business, so a double click, a retry after a slow
 * response or two open tabs all end with the same link. Only a link that is
 * saved is ever returned.
 */
export async function POST() {
  const caller = await authorize();
  if (caller.response) return caller.response;

  const limited = await enforcePolicy("sensitive.referral-link", {
    subject: `${caller.organization.id}:${caller.user.id}`,
  });
  if (limited) return limited;

  try {
    const service = await getReferralServiceReady();
    const result = await service.ensureLink(caller.organization.id);
    if (!result.ok) {
      return reply({ error: result.reason }, REFUSAL_STATUS[result.reason]);
    }
    return reply(
      linkBody(result.code, result.created),
      result.created ? 201 : 200,
    );
  } catch (error) {
    logReferralFailure("link creation", error);
    return reply({ error: "storage_unavailable" }, 503);
  }
}
