import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import {
  prepareLiveDemo,
  verifyLiveDemo,
} from "@/product/agent-tools/agents/live-demo";

export const dynamic = "force-dynamic";

const consentSchema = z.object({
  prospectName: z.string().min(1),
  method: z.enum(["verbal", "written", "sms", "email"]),
  at: z.string().min(1),
});

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("prepare"),
    demoClientId: z.string().min(1),
    organizationId: z.string().nullable().optional(),
    consent: consentSchema.nullable(),
  }),
  z.object({
    action: z.literal("verify"),
    demoClientId: z.string().min(1),
    organizationId: z.string().nullable().optional(),
    callerE164: z.string().min(1),
    withinMs: z.number().int().positive().optional(),
  }),
]);

/**
 * Ops-only trigger for the live-demo sales agent (growth playbook agent #5).
 * `prepare` returns the number to dial — gated on prospect consent being on
 * record. `verify` confirms, right after the call, that the recovery SMS
 * actually went out and how fast. Never places a call itself.
 */
export async function POST(request: NextRequest) {
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }
  const audit = logOpsAccess(request, "growth.live-demo");
  if (audit.missingActor) {
    return missingOpsActorResponse();
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (parsed.data.action === "prepare") {
    const result = await prepareLiveDemo({
      organizationId: parsed.data.organizationId ?? null,
      demoClientId: parsed.data.demoClientId,
      consent: parsed.data.consent,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 403 });
  }

  const result = await verifyLiveDemo({
    organizationId: parsed.data.organizationId ?? null,
    demoClientId: parsed.data.demoClientId,
    callerE164: parsed.data.callerE164,
    withinMs: parsed.data.withinMs,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
