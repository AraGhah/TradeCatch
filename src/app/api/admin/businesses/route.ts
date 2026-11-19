import {
  adminReply,
  dateParam,
  guardAdmin,
  pageParams,
} from "@/lib/admin-route";
import { readJsonBody } from "@/lib/request-body";
import { recordAdminAction } from "@/product/admin-console/audit";
import {
  createBusiness,
  createBusinessSchema,
  listBusinesses,
} from "@/product/admin-console/businesses";
import { clearPlatformSnapshot } from "@/product/admin/platform-snapshot";
import { maskContact } from "@/product/security/audit-changes";
import { sendActivationInvite } from "@/product/saas/auth/magic-link";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["active", "suspended", "churned"]);

/**
 * Businesses for administrators: name, owner contact, plan, status, created
 * date and the synchronized subscription state. Filters: q, status, plan,
 * accountType, from / to (creation date). Paged.
 */
export async function GET(request: Request) {
  const guard = await guardAdmin(request, "admin.read");
  if (!guard.ok) return guard.response;
  const params = new URL(request.url).searchParams;
  const status = params.get("status") || undefined;
  if (status && !STATUSES.has(status))
    return adminReply({ error: "Unknown status." }, 400);
  const { page, pageSize } = pageParams(params);
  try {
    const result = await listBusinesses({
      q: params.get("q")?.slice(0, 100) || undefined,
      status,
      plan: params.get("plan") || undefined,
      accountType: params.get("accountType") || undefined,
      from: dateParam(params.get("from")),
      to: dateParam(params.get("to")),
      page,
      pageSize,
    });
    return adminReply({ ok: true, ...result });
  } catch (error) {
    console.error("[admin] business list failed", error);
    return adminReply({ error: "Businesses are unavailable." }, 503);
  }
}

/**
 * Creates a customer account by hand. Public registration stays closed; this
 * needs the business.create role. The owner is emailed a single-use link to
 * choose their own password, so no password exists until they do. Refuses an
 * email that already belongs to a business.
 */
export async function POST(request: Request) {
  const guard = await guardAdmin(request, "business.create");
  if (!guard.ok) return guard.response;
  const { actor } = guard.access;

  const read = await readJsonBody(request, 8192);
  if (!read.ok) return adminReply({ error: read.error }, read.status);
  const parsed = createBusinessSchema.safeParse(read.data);
  if (!parsed.success) {
    return adminReply(
      {
        error: "Check the business and owner details.",
        fields: parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
      },
      400,
    );
  }
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    new URL(request.url).origin;

  try {
    const result = await createBusiness(parsed.data, {
      store: getSaasStore(),
      sendInvite: ({ email, locale, organizationId }) =>
        sendActivationInvite({ email, locale, origin, organizationId }),
    });
    if (!result.ok) {
      await recordAdminAction(actor, {
        action: "admin_business_create_refused",
        outcome: "failed",
        detail: result.error,
        changes: [
          { field: "ownerEmail", to: maskContact(parsed.data.ownerEmail) },
        ],
      });
      return result.error === "email_exists"
        ? adminReply(
            {
              error: "That email already belongs to a business.",
              code: "email_exists",
            },
            409,
          )
        : adminReply({ error: "The account could not be created." }, 500);
    }
    clearPlatformSnapshot();
    await recordAdminAction(actor, {
      action: "admin_business_created",
      organizationId: result.organization.id,
      target: result.organization.id,
      changes: [
        { field: "name", to: result.organization.name },
        { field: "plan", to: result.organization.plan },
        { field: "ownerEmail", to: maskContact(result.owner.email) },
        { field: "inviteSent", to: String(result.invite.sent) },
      ],
    });
    return adminReply(
      {
        ok: true,
        id: result.organization.id,
        name: result.organization.name,
        plan: result.organization.plan,
        invite: result.invite,
      },
      201,
    );
  } catch (error) {
    console.error("[admin] business create failed", error);
    return adminReply({ error: "The account could not be created." }, 503);
  }
}
