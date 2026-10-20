import { NextRequest, NextResponse } from "next/server";
import { putCallRouting } from "@/product/receptionist/ai-receptionist-service";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { authorizeBusinessMemberOrAdmin, loadClientForOrg } from "../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const client = await loadClientForOrg(access.organization);
  if (!client) {
    return NextResponse.json(
      { error: "Phone client is not linked." },
      { status: 409 },
    );
  }

  let body: { callHandlingMode?: unknown; businessHours?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const runtime = getReceptionistRuntime();
  const result = await putCallRouting(runtime.profileStore, {
    organizationId: id,
    client,
    role: access.role,
    userEmail: access.userEmail,
    callHandlingMode: body.callHandlingMode,
    businessHours: body.businessHours,
  });
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }
  await runtime.refresh(true);
  return NextResponse.json({
    ok: true,
    callHandlingMode: result.profile.settings.callHandlingMode,
    businessHours: result.profile.settings.businessHours ?? null,
    updatedAt: result.profile.updatedAt,
  });
}
