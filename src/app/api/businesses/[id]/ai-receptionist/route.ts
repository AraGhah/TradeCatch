import { NextRequest, NextResponse } from "next/server";
import {
  buildOverview,
  patchAiReceptionistSettings,
} from "@/product/receptionist/ai-receptionist-service";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import {
  authorizeBusinessMemberOrAdmin,
  loadClientForOrg,
} from "../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const runtime = getReceptionistRuntime();
  let integrationError: string | undefined;
  try {
    await runtime.refresh(true);
  } catch (err) {
    integrationError =
      err instanceof Error ? err.message : "Receptionist runtime unavailable";
  }

  const profile = await runtime.profileStore.getProfile(id);
  const client = await loadClientForOrg(access.organization);
  const calls = client
    ? await runtime.store.listSessions({
        clientAccountId: client.id,
        limit: 200,
      })
    : [];
  const answering = runtime.configs.some(
    (c) => c.id === `rc_org_${id}` || c.clientAccountId === client?.id,
  );

  const overview = buildOverview({
    organization: access.organization,
    profile,
    client,
    calls,
    answering,
    integrationError,
  });

  return NextResponse.json({
    ok: true,
    receptionist: overview,
    linked: Boolean(client),
  });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const client = await loadClientForOrg(access.organization);
  if (!client) {
    return NextResponse.json(
      {
        error:
          "Your phone client is not linked yet. Ask the founder to connect it.",
      },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const runtime = getReceptionistRuntime();
  const result = await patchAiReceptionistSettings(runtime.profileStore, {
    organizationId: id,
    client,
    role: access.role,
    userEmail: access.userEmail,
    body,
  });
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }
  await runtime.refresh(true);
  return NextResponse.json({
    ok: true,
    settings: result.profile.settings,
    activated: result.profile.activated,
    updatedAt: result.profile.updatedAt,
  });
}
