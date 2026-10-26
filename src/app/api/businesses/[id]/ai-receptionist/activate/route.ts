import { NextRequest, NextResponse } from "next/server";
import { ownerToggleActivation } from "@/product/receptionist/profile-service";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { getSaasStore } from "@/product/saas/runtime";
import { getMissedCallReadStore } from "@/product/missed-call/runtime";
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
      getClient: (clientId) => getMissedCallReadStore().getClient(clientId),
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
