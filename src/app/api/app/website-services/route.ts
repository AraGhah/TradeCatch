import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendWebsiteRequestEmail } from "@/lib/email";
import { enforceRateLimit } from "@/lib/rate-limit-response";
import { readJsonBody } from "@/lib/request-body";
import { websiteRequestSchema } from "@/lib/validation/website-request";
import { forbiddenUnless } from "@/product/security/access";
import {
  requireTenantContext,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { toWebsiteRequestView } from "@/product/website-services/model";
import { getWebsiteRequestService } from "@/product/website-services/runtime";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store, max-age=0" };
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers });

/**
 * A signed-in request may come from onboarding or the dashboard. "pricing" is
 * the public form's own source and is not accepted here, and the business is
 * always the caller's own: it is never read from the body.
 */
const memberRequestSchema = websiteRequestSchema.safeExtend({
  source: z.enum(["onboarding", "dashboard"]),
  idempotencyKey: z.string().uuid().optional(),
});

/** The requests of the caller's own business, newest first. */
export async function GET() {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  try {
    const requests = await getWebsiteRequestService().listForOrganization(
      auth.ctx.organization.id,
    );
    return reply({ ok: true, requests: requests.map(toWebsiteRequestView) });
  } catch (error) {
    console.error("[website-services] list failed", error);
    return reply({ error: "Website requests are unavailable." }, 503);
  }
}

/**
 * Ask for the Done-for-You Website Service. This only records the request: it
 * does not change the subscription, create a Stripe price or charge anything.
 * The team replies with a written scope and price first.
 */
export async function POST(request: NextRequest) {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  const { organization, membership, user } = auth.ctx;

  // Commissioning paid work is an owner/administrator decision, like billing.
  const denied = forbiddenUnless(membership.role, "manage_billing");
  if (denied) return denied;

  const limited = await enforceRateLimit({
    scope: "website-service-request",
    subject: `${organization.id}:${user.id}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (limited) return limited;

  const read = await readJsonBody(request, 16_384);
  if (!read.ok) return reply({ error: read.error }, read.status);
  const parsed = memberRequestSchema.safeParse(read.data);
  if (!parsed.success) return reply({ error: "Invalid request." }, 400);
  const { source, idempotencyKey, ...details } = parsed.data;

  try {
    const { created, request: saved } = await getWebsiteRequestService().submit(
      details,
      {
        organizationId: organization.id,
        source,
        idempotencyKey,
        createdByUserId: user.id,
      },
    );
    if (created) await sendWebsiteRequestEmail(saved, idempotencyKey);
    return reply(
      { ok: true, request: toWebsiteRequestView(saved) },
      created ? 201 : 200,
    );
  } catch (error) {
    console.error("[website-services] create failed", error);
    return reply({ error: "We couldn't record your request." }, 503);
  }
}
