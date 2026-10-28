import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { getSaasStore } from "@/product/saas/runtime";
import {
  NumberProvisioningError,
  type AvailableNumber,
} from "@/product/missed-call/number-provisioning";
import { provisionOrganizationSmsNumber } from "@/product/missed-call/provision-organization";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  areaCode: z.string().trim().regex(/^\d{3}$/).optional(),
});

/**
 * Founder/ops helper: buys a real Twilio number (charges the account) and
 * links it to a SaaS organization in one authenticated call, replacing the
 * old "edit a Cloudflare env var, then call /ops/link-organization"
 * two-step. Bearer ops auth + X-Ops-Actor in production — this spends
 * real money, so it stays behind the same authorization boundary as every
 * other PII/ops action, never reachable from the tenant dashboard.
 */
export async function POST(request: NextRequest) {
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }
  const audit = logOpsAccess(request, "ops.provision_number");
  if (audit.missingActor) {
    return missingOpsActorResponse();
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const saas = getSaasStore();
  const org = await saas.getOrganization(parsed.data.organizationId);
  if (!org) {
    return NextResponse.json(
      { error: "Organization not found." },
      { status: 404 },
    );
  }

  const { store } = await ensureMissedCallReady();
  try {
    const result = await provisionOrganizationSmsNumber(
      {
        store,
        linkMissedCallClient: (organizationId, clientId) =>
          saas.linkMissedCallClient(organizationId, clientId),
      },
      {
        organization: {
          id: org.id,
          name: org.name,
          timezone: org.timezone,
          phoneE164: org.phoneE164,
          missedCallClientId: org.missedCallClientId,
        },
        areaCode: parsed.data.areaCode,
        chooseNumber: (candidates: AvailableNumber[]) => candidates[0]!,
      },
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof NumberProvisioningError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[ops/provision-number]", err);
    return NextResponse.json(
      { error: "Failed to provision an SMS receptionist number." },
      { status: 500 },
    );
  }
}
