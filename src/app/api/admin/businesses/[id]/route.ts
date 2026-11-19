import { adminReply, guardAdmin } from "@/lib/admin-route";
import { readJsonBody } from "@/lib/request-body";
import { recordAdminAction } from "@/product/admin-console/audit";
import {
  BUSINESS_AUDIT_FIELDS,
  getBusinessDetail,
  updateBusiness,
  updateBusinessSchema,
} from "@/product/admin-console/businesses";
import { clearPlatformSnapshot } from "@/product/admin/platform-snapshot";
import { summarizeChanges } from "@/product/security/audit-changes";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Organization ids are `org_` plus a uuid/slug; anything else is never a real id. */
const ID = /^[A-Za-z0-9_-]{4,80}$/;

/** One business with its members, plan entitlements, receptionist and integration status. */
export async function GET(request: Request, { params }: Params) {
  const guard = await guardAdmin(request, "admin.read");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!ID.test(id)) return adminReply({ error: "Business not found." }, 404);
  try {
    const detail = await getBusinessDetail(id);
    if (!detail) return adminReply({ error: "Business not found." }, 404);
    return adminReply({ ok: true, business: detail });
  } catch (error) {
    console.error("[admin] business read failed", error);
    return adminReply({ error: "Businesses are unavailable." }, 503);
  }
}

/**
 * Correct a business's information. Plan and status are NOT changed here: a
 * plan changes through the subscription (Stripe) and status through its own
 * confirmed action.
 */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await guardAdmin(request, "business.write");
  if (!guard.ok) return guard.response;
  const { actor } = guard.access;
  const { id } = await params;
  if (!ID.test(id)) return adminReply({ error: "Business not found." }, 404);

  const read = await readJsonBody(request, 4096);
  if (!read.ok) return adminReply({ error: read.error }, read.status);
  const parsed = updateBusinessSchema.safeParse(read.data);
  if (!parsed.success) {
    return adminReply(
      {
        error: "Check the details and try again.",
        fields: parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
      },
      400,
    );
  }

  try {
    const result = await updateBusiness(id, parsed.data);
    if (!result.ok) {
      return result.error === "not_found"
        ? adminReply({ error: "Business not found." }, 404)
        : adminReply({ error: "Nothing changed.", code: "no_change" }, 409);
    }
    clearPlatformSnapshot();
    await recordAdminAction(actor, {
      action: "admin_business_updated",
      organizationId: id,
      target: id,
      changes: summarizeChanges(
        result.before as unknown as Record<string, unknown>,
        result.after as unknown as Record<string, unknown>,
        BUSINESS_AUDIT_FIELDS,
      ),
    });
    return adminReply({ ok: true, business: await getBusinessDetail(id) });
  } catch (error) {
    console.error("[admin] business update failed", error);
    return adminReply({ error: "The business could not be updated." }, 503);
  }
}
