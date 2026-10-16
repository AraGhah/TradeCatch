import { NextRequest, NextResponse } from "next/server";
import { hasEffectiveFeature } from "@/product/billing/entitlementService";
import { getSubscriptionService } from "@/product/billing/runtime";
import { ownerToggleActivation } from "@/product/receptionist/profile-service";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { getSaasStore } from "@/product/saas/runtime";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import {
  authorizeBusinessMemberOrAdmin,
  loadClientForOrg,
} from "../../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const entitlements = await getSubscriptionService().getEffective(
    id,
    access.organization.plan,
  );
  if (!hasEffectiveFeature(entitlements, "AI_PHONE_ANSWERING")) {
    return NextResponse.json(
      {
        error: "Feature not included in your plan.",
        feature: "AI_PHONE_ANSWERING",
        upgrade: "ai_receptionist",
      },
      { status: 402 },
    );
  }

  const client = await loadClientForOrg(access.organization);
  if (!client) {
    return NextResponse.json(
      { error: "Link the organization to a missed-call client first." },
      { status: 409 },
    );
  }

  const runtime = getReceptionistRuntime();
  const saas = getSaasStore();
  const result = await ownerToggleActivation(
    {
      profiles: runtime.profileStore,
      getOrganization: (orgId) => saas.getOrganization(orgId),
      getClient: async (clientId) => {
        const { store } = await ensureMissedCallReady();
        return store.getClient(clientId);
      },
      getOrgPhone: async (orgId) => {
        const org = await saas.getOrganization(orgId);
        return org?.phoneE164;
      },
      refresh: (force) => runtime.refresh(force),
      isAnswering: (organizationId) =>
        runtime.configs.some((c) => c.id === `rc_org_${organizationId}`),
    },
    {
      organization: access.organization,
      role: access.role,
      userEmail: access.userEmail,
      activated: true,
    },
  );
  return NextResponse.json(result.body, { status: result.status });
}
