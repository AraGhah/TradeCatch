import { NextRequest, NextResponse } from "next/server";
import { forbiddenUnless } from "@/product/security/access";
import { CrmError, getCrmService } from "@/product/crm/runtime";
import {
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  type LeadPriority,
  type LeadSource,
  type LeadStatus,
} from "@/product/crm/types";
import { authorizeBusinessMemberOrAdmin } from "../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function one(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const url = new URL(request.url);
  const status = one(url.searchParams.get("status"));
  const source = one(url.searchParams.get("source"));
  const priority = one(url.searchParams.get("priority"));
  if (status && !LEAD_STATUSES.includes(status as LeadStatus)) {
    return NextResponse.json({ error: "Unknown status." }, { status: 400 });
  }
  if (source && !LEAD_SOURCES.includes(source as LeadSource)) {
    return NextResponse.json({ error: "Unknown source." }, { status: 400 });
  }
  if (priority && !LEAD_PRIORITIES.includes(priority as LeadPriority)) {
    return NextResponse.json({ error: "Unknown priority." }, { status: 400 });
  }

  try {
    const leads = await getCrmService().listLeads(id, {
      q: one(url.searchParams.get("q")),
      status: status as LeadStatus | undefined,
      source: source as LeadSource | undefined,
      priority: priority as LeadPriority | undefined,
      from: one(url.searchParams.get("from")),
      to: one(url.searchParams.get("to")),
    });
    return NextResponse.json({ ok: true, leads });
  } catch (err) {
    console.error("[crm] list leads", err);
    return NextResponse.json(
      { error: "Could not load leads." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;
  const denied = forbiddenUnless(
    access.role,
    "write_leads",
    access.via === "admin",
  );
  if (denied) return denied;

  let body: {
    phoneE164?: string;
    displayName?: string;
    email?: string;
    service?: string;
    description?: string;
    location?: string;
    priority?: string;
    preferredLanguage?: "en" | "fr";
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  try {
    const result = await getCrmService().capture({
      organizationId: id,
      source: "manual",
      phoneE164: body.phoneE164 ?? "",
      displayName: body.displayName,
      email: body.email,
      service: body.service,
      description: body.description,
      location: body.location,
      priority: body.priority as LeadPriority | undefined,
      preferredLanguage: body.preferredLanguage,
      actor: access.userEmail,
    });
    return NextResponse.json({
      ok: true,
      lead: result.lead,
      created: result.created,
    });
  } catch (err) {
    if (err instanceof CrmError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[crm] create lead", err);
    return NextResponse.json(
      { error: "Could not create the lead." },
      { status: 500 },
    );
  }
}
