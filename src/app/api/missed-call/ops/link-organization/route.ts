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

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  missedCallClientId: z.string().min(1),
});

/**
 * Founder/ops helper: attach a Module A client to a SaaS organization.
 * Bearer ops auth + X-Ops-Actor in production.
 */
export async function POST(request: NextRequest) {
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }
  const audit = logOpsAccess(request, "ops.link_organization");
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

  const { store: missedCallStore } = await ensureMissedCallReady();
  const client = await missedCallStore.getClient(parsed.data.missedCallClientId);
  if (!client) {
    return NextResponse.json(
      { error: "Missed-call client not found. Save client config first." },
      { status: 404 },
    );
  }

  const saas = getSaasStore();
  const org = await saas.getOrganization(parsed.data.organizationId);
  if (!org) {
    return NextResponse.json(
      { error: "Organization not found." },
      { status: 404 },
    );
  }

  try {
    const linked = await saas.linkMissedCallClient(
      org.id,
      parsed.data.missedCallClientId,
    );
    return NextResponse.json({
      ok: true,
      organization: linked,
      missedCallClientId: parsed.data.missedCallClientId,
    });
  } catch (err) {
    console.error("[ops/link-organization]", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to link organization to missed-call client.",
      },
      { status: 500 },
    );
  }
}
