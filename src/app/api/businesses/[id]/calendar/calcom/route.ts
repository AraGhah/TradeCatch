import { NextResponse } from "next/server";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import {
  calcomMultiCrew,
  calcomPilotAllowed,
  connectCalcom,
  connectCalcomSchema,
  disconnectCalcom,
  publicConnection,
  type ConnectProblem,
} from "@/product/scheduling/calcom/connection";
import {
  getSchedulingService,
  getSchedulingStore,
} from "@/product/scheduling/runtime";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const MAX_BODY_BYTES = 8 * 1024;

const STATUS: Record<ConnectProblem, number> = {
  api_key_required: 400,
  unauthorized: 422,
  unreachable: 502,
  event_type_not_found: 422,
  event_type_unbookable: 422,
  unknown_service: 422,
  unknown_technician: 422,
  duplicate_route: 422,
  specialists_not_included: 403,
};

function denied(access: { error: string; status: number }) {
  return NextResponse.json({ error: access.error }, { status: access.status });
}

function notEnrolled() {
  return NextResponse.json(
    {
      error:
        "Cal.com is available on the Professional plan, once it has been switched on for your business.",
      code: "calcom_pilot_required",
    },
    { status: 403 },
  );
}

/** The saved connection, never the key. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "read");
  if (!access.ok) return denied(access);
  const organization = await getSaasStore().getOrganization(id);
  return NextResponse.json({
    ok: true,
    enabled: calcomPilotAllowed(organization),
    specialistCalendars: calcomMultiCrew(organization),
    connection: publicConnection(
      await getSchedulingStore().getCalcomConnection(id),
    ),
  });
}

/**
 * Connect Cal.com or change its event-type mapping. The key is checked
 * against Cal.com first; nothing is saved unless every event type is real,
 * bookable without confirmation, and every service and technician belongs to
 * this business.
 */
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok) return denied(access);
  const organization = await getSaasStore().getOrganization(id);
  if (!calcomPilotAllowed(organization)) return notEnrolled();

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = connectCalcomSchema.safeParse(json);
  if (!parsed.success) {
    // Field names only: a rejected body may contain the key.
    return NextResponse.json(
      {
        error: "Invalid request.",
        fields: [
          ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
        ],
      },
      { status: 400 },
    );
  }
  const result = await connectCalcom(
    {
      store: getSchedulingStore(),
      scheduling: getSchedulingService(),
      multiCrew: calcomMultiCrew(organization),
    },
    id,
    parsed.data,
  );
  if (!result.ok) {
    return NextResponse.json(
      {
        error: "Cal.com was not connected.",
        code: result.code,
        detail: result.detail,
      },
      { status: STATUS[result.code] },
    );
  }
  return NextResponse.json({
    ok: true,
    connection: result.connection,
    warnings: result.warnings,
  });
}

/** Remove the key and stop using Cal.com. */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok) return denied(access);
  await disconnectCalcom(
    { store: getSchedulingStore(), scheduling: getSchedulingService() },
    id,
  );
  return NextResponse.json({
    ok: true,
    connection: publicConnection(
      await getSchedulingStore().getCalcomConnection(id),
    ),
  });
}
