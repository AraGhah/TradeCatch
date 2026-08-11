import { NextResponse } from "next/server";
import {
  FEATURE_LABELS,
  featuresForPlan,
} from "@/product/saas/entitlements";
import {
  requireTenantContext,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireTenantContext();
  if (!auth.ok) {
    return unauthorizedTenantResponse(auth.error);
  }

  const { user, organization, membership, features } = auth.ctx;
  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      locale: user.locale,
    },
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      plan: organization.plan,
      status: organization.status,
      missedCallClientId: organization.missedCallClientId,
    },
    membership: { role: membership.role },
    features,
    featureLabels: Object.fromEntries(
      featuresForPlan(organization.plan).map((f) => [
        f,
        FEATURE_LABELS[f],
      ]),
    ),
  });
}
