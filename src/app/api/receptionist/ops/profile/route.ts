import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { activateProfile } from "@/product/receptionist/profile-service";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  /** The Twilio number callers dial (E.164). */
  phoneNumberE164: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, "must be E.164"),
  activated: z.boolean(),
});

/**
 * Founder/ops: assign the Twilio number a client's receptionist answers and
 * switch it on or off. The client can edit content but never this. Bearer ops
 * auth + X-Ops-Actor in production.
 */
export async function POST(request: NextRequest) {
  if (!authorizeOpsRequest(request)) return unauthorizedOpsResponse();
  const audit = logOpsAccess(request, "receptionist.ops.profile");
  if (audit.missingActor) return missingOpsActorResponse();

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const runtime = getReceptionistRuntime();
  const saas = getSaasStore();
  const result = await activateProfile(
    {
      profiles: runtime.profileStore,
      getOrganization: (id) => saas.getOrganization(id),
      getClient: async (id) => {
        const { store } = await ensureMissedCallReady();
        return store.getClient(id);
      },
      refresh: (force) => runtime.refresh(force),
      isAnswering: (organizationId) =>
        runtime.configs.some((c) => c.id === `rc_org_${organizationId}`),
    },
    { ...parsed.data, actor: audit.actor },
  );
  return NextResponse.json(result.body, { status: result.status });
}
