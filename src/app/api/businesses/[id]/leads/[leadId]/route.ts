import { NextRequest, NextResponse } from "next/server";
import { forbiddenUnless } from "@/product/security/access";
import { CrmError, getCrmService } from "@/product/crm/runtime";
import { authorizeBusinessMemberOrAdmin } from "../../_shared";
import { getSaasStore } from "@/product/saas/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; leadId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id, leadId } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const service = getCrmService();
  const lead = await service.getLead(id, leadId);
  if (!lead) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const events = await service.listEvents(id, leadId);
  const conversation = lead.conversationId
    ? await service.getConversationBundle(id, lead.conversationId)
    : null;
  return NextResponse.json({ ok: true, lead, events, conversation });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, leadId } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;
  const denied = forbiddenUnless(
    access.role,
    "write_leads",
    access.via === "admin",
  );
  if (denied) return denied;

  let body: {
    status?: string;
    priority?: string;
    service?: string;
    description?: string;
    location?: string;
    assignedToUserId?: string | null;
    notes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  try {
    const service = getCrmService();
    let assignedToName: string | null | undefined;
    if (body.assignedToUserId) {
      const memberships =
        await getSaasStore().listMembershipsForOrganization(id);
      const member = memberships.find(
        (m) => m.userId === body.assignedToUserId,
      );
      if (!member) {
        return NextResponse.json(
          { error: "That person is not on this business." },
          { status: 400 },
        );
      }
      const user = await getSaasStore().getUser(member.userId);
      assignedToName = user?.name ?? user?.email ?? member.userId;
    } else if (body.assignedToUserId === null || body.assignedToUserId === "") {
      assignedToName = null;
    }

    const current = await service.getLead(id, leadId);
    if (!current) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (typeof body.notes === "string") {
      await service.updateCustomerNotes(id, current.customerId, body.notes);
    }
    const lead = await service.updateLead(id, leadId, {
      status: body.status,
      priority: body.priority,
      service: body.service,
      description: body.description,
      location: body.location,
      assignedToUserId: body.assignedToUserId,
      assignedToName,
      actor: access.userEmail,
    });
    return NextResponse.json({ ok: true, lead });
  } catch (err) {
    if (err instanceof CrmError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[crm] update lead", err);
    return NextResponse.json(
      { error: "Could not update the lead." },
      { status: 500 },
    );
  }
}
