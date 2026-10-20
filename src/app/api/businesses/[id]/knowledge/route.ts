import { NextRequest, NextResponse } from "next/server";
import { putKnowledge } from "@/product/receptionist/ai-receptionist-service";
import { defaultProfileSettings } from "@/product/receptionist/profile";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { authorizeBusinessMemberOrAdmin, loadClientForOrg } from "../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const profile = await getReceptionistRuntime().profileStore.getProfile(id);
  const settings = profile?.settings ?? defaultProfileSettings();
  return NextResponse.json({
    ok: true,
    knowledge: settings.knowledge,
    faqs: settings.faqs,
    businessFacts: settings.businessFacts ?? null,
  });
}

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

  let body: { knowledge?: unknown; faqs?: unknown };
  try {
    body = (await request.json()) as { knowledge?: unknown; faqs?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const runtime = getReceptionistRuntime();
  const result = await putKnowledge(runtime.profileStore, {
    organizationId: id,
    client,
    role: access.role,
    userEmail: access.userEmail,
    knowledge: body.knowledge ?? {},
    faqs: body.faqs,
  });
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }
  await runtime.refresh(true);
  return NextResponse.json({
    ok: true,
    knowledge: result.profile.settings.knowledge,
    faqs: result.profile.settings.faqs,
    updatedAt: result.profile.updatedAt,
  });
}
