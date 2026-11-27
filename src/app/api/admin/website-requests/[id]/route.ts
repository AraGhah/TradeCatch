import { adminReply, guardAdmin } from "@/lib/admin-route";
import { readJsonBody } from "@/lib/request-body";
import { websiteRequestUpdateSchema } from "@/lib/validation/website-request";
import { recordAdminAction } from "@/product/admin-console/audit";
import {
  summarizeChanges,
  type AuditChange,
} from "@/product/security/audit-changes";
import { referralWebsiteServiceStarted } from "@/product/referrals/billing-hooks";
import type { WebsiteRequestUpdateError } from "@/product/website-services/service";
import { getWebsiteRequestService } from "@/product/website-services/runtime";
import { isCustomerDecision } from "@/product/website-services/decision-email";
import { notifyCustomerOfDecision } from "@/product/website-services/notify";

export const dynamic = "force-dynamic";

const STATUS_FOR_ERROR: Record<WebsiteRequestUpdateError, number> = {
  not_found: 404,
  invalid_transition: 409,
  invalid_payment_transition: 409,
  payment_not_allowed: 409,
  review_note_required: 400,
  customer_reason_required: 400,
  locked: 409,
  conflict: 409,
  price_too_low: 400,
  price_mismatch: 400,
  quote_required: 400,
};

const MESSAGE_FOR_ERROR: Record<WebsiteRequestUpdateError, string> = {
  not_found: "Request not found.",
  invalid_transition:
    "That status change is not allowed from the current status.",
  invalid_payment_transition:
    "That payment status change is not allowed from the current payment status.",
  payment_not_allowed:
    "Payment can only be requested once the work is approved or quoted.",
  review_note_required: "Add the reason before rejecting a request.",
  customer_reason_required:
    "Write the reason the customer will receive before rejecting a request.",
  locked: "The agreed scope and price cannot be changed once work has started.",
  conflict:
    "The request changed while you were editing it. Reload and try again.",
  price_too_low: "The price cannot be below the starting price.",
  price_mismatch: "The price must match the published website service price.",
  quote_required:
    "Add the written scope and the final price before quoting, requesting payment or starting work.",
};

type Params = { params: Promise<{ id: string }> };

const ID = /^wsr_[A-Za-z0-9-]{8,64}$/;

/** One request with its full history, for administrators. */
export async function GET(request: Request, { params }: Params) {
  const guard = await guardAdmin(request, "admin.read");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!ID.test(id))
    return adminReply({ error: MESSAGE_FOR_ERROR.not_found }, 404);
  try {
    const service = getWebsiteRequestService();
    const found = await service.getAny(id);
    if (!found) return adminReply({ error: MESSAGE_FOR_ERROR.not_found }, 404);
    return adminReply({
      ok: true,
      request: found,
      history: await service.history(id),
    });
  } catch (error) {
    console.error("[website-requests] admin read failed", error);
    return adminReply({ error: "Website requests are unavailable." }, 503);
  }
}

/**
 * Move a request through review, approval, quote, work and delivery, and
 * record the scope, the final price and where payment stands. Administrators
 * only. The request is NEVER charged from here: asking for payment only records
 * the ask; the customer pays through a Stripe flow they complete themselves.
 */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await guardAdmin(request, "website.write");
  if (!guard.ok) return guard.response;
  const { actor } = guard.access;

  const { id } = await params;
  if (!ID.test(id))
    return adminReply({ error: MESSAGE_FOR_ERROR.not_found }, 404);
  const read = await readJsonBody(request, 8192);
  if (!read.ok) return adminReply({ error: read.error }, read.status);
  const parsed = websiteRequestUpdateSchema.safeParse(read.data);
  if (!parsed.success) return adminReply({ error: "Invalid update." }, 400);

  try {
    const service = getWebsiteRequestService();
    const before = await service.getAny(id);
    const result = await service.adminUpdate(id, parsed.data, actor.label);
    if (!result.ok) {
      await recordAdminAction(actor, {
        action: "admin_website_request_update_refused",
        target: id,
        outcome: "failed",
        detail: result.error,
      });
      return adminReply(
        { error: MESSAGE_FOR_ERROR[result.error], code: result.error },
        STATUS_FOR_ERROR[result.error],
      );
    }

    // What changed, without the free-text scope or note (they can hold a
    // customer's details): the audit log says THAT they changed, not what they say.
    const fields = ["status", "paymentStatus", "quotedPriceCad"] as const;
    const changes: AuditChange[] = before
      ? summarizeChanges(
          before as unknown as Record<string, unknown>,
          result.request as unknown as Record<string, unknown>,
          fields,
        )
      : [];
    if (before && before.scopeSummary !== result.request.scopeSummary) {
      changes.push({ field: "scopeSummary" });
    }
    if (before && before.reviewNote !== result.request.reviewNote) {
      changes.push({ field: "reviewNote" });
    }
    await recordAdminAction(actor, {
      action: "admin_website_request_updated",
      organizationId: result.request.organizationId ?? undefined,
      target: id,
      changes,
    });

    // Work has started, so the customer has agreed to buy the service: the
    // customer who referred them may earn the website bonus (best effort,
    // idempotent, and still needs an administrator's approval).
    if (
      result.request.organizationId &&
      (result.request.status === "in_progress" ||
        result.request.status === "delivered")
    ) {
      await referralWebsiteServiceStarted({
        organizationId: result.request.organizationId,
        requestId: result.request.id,
      });
    }
    // The customer hears about an approval or a rejection the moment it is
    // made: only on the update that moved the status, once per decision.
    const decided =
      before?.status !== result.request.status &&
      isCustomerDecision(result.request.status);
    const customerEmail = decided
      ? await notifyCustomerOfDecision(result.request, {
          reason: parsed.data.customerReason ?? null,
        })
      : undefined;

    return adminReply({
      ok: true,
      request: result.request,
      ...(customerEmail ? { customerEmail } : {}),
      history: await service.history(id),
    });
  } catch (error) {
    console.error("[website-requests] admin update failed", error);
    return adminReply({ error: "Website requests are unavailable." }, 503);
  }
}
