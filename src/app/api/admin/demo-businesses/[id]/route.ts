import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import {
  deleteDemoBusiness,
  toDemoBusinessProfile,
} from "@/product/demo/business-service";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  const saas = getSaasStore();
  const org = await saas.getOrganization(id);
  if (!org || org.accountType !== "demo") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const members = await saas.listMembershipsForOrganization(org.id);
  const ownerMem = members.find((m) => m.role === "owner") ?? members[0];
  const owner = ownerMem ? await saas.getUser(ownerMem.userId) : null;

  return NextResponse.json({
    ok: true,
    business: toDemoBusinessProfile(org, owner),
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  try {
    await deleteDemoBusiness(id);
    return NextResponse.json({ ok: true, deleted: id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
