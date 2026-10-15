import { NextRequest, NextResponse } from "next/server";
import { putTransferSettings } from "@/product/receptionist/ai-receptionist-service";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import {
  authorizeBusinessMemberOrAdmin,
  loadClientForOrg,
} from "../_shared";

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

  let body: {
    transferSettings?: unknown;
    emergencyTransferE164?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const runtime = getReceptionistRuntime();
  const result = await putTransferSettings(runtime.profileStore, {
    organizationId: id,
    client,
    role: access.role,
    userEmail: access.userEmail,
    transferSettings: body.transferSettings ?? {},
    emergencyTransferE164: body.emergencyTransferE164,
  });
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }
  await runtime.refresh(true);
  return NextResponse.json({
    ok: true,
    transferSettings: result.profile.settings.transferSettings,
    emergencyTransferE164:
      result.profile.settings.emergencyTransferE164 ?? null,
    updatedAt: result.profile.updatedAt,
  });
}
