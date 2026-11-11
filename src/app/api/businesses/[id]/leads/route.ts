import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parsePhoneInput } from "@/product/crm/phone";
import { comparisonKey } from "@/product/crm/record-quality";
import { forbiddenUnless } from "@/product/security/access";
import { isCrmError, getCrmService } from "@/product/crm/runtime";
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

const createSchema = z.object({
  phoneE164: z.string().trim().min(1).max(40),
  displayName: z.string().trim().max(120).optional(),
  email: z.string().trim().max(254).optional(),
  service: z.string().trim().max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  location: z.string().trim().max(300).optional(),
  priority: z
    .string()
    .refine((value) => LEAD_PRIORITIES.includes(value as LeadPriority))
    .optional(),
  preferredLanguage: z.enum(["en", "fr"]).optional(),
  /**
   * The number is already a customer under another name: "keep" adds the
   * request to that customer as is, "rename" uses the name just typed.
   */
  existingCustomer: z.enum(["keep", "rename"]).optional(),
});

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

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    // Name the field and the reason, so the form can say what to fix.
    const issue = parsed.error.issues[0];
    const field = String(issue?.path[0] ?? "");
    return NextResponse.json(
      {
        error: "Invalid request.",
        code:
          field === "phoneE164"
            ? "invalid_phone"
            : issue?.code === "too_big"
              ? "too_long"
              : "invalid_values",
        field,
      },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const phone = parsePhoneInput(body.phoneE164);
  if (!phone) {
    return NextResponse.json(
      {
        error: "A valid phone number is required.",
        code: "invalid_phone",
        field: "phoneE164",
      },
      { status: 400 },
    );
  }

  try {
    const crm = getCrmService();
    // A typed name replaces the name on file. Never do that silently when the
    // number already belongs to a customer with a different name.
    const onFile = await crm.findCustomerByPhone(id, phone);
    const differentName =
      Boolean(onFile?.displayName && body.displayName) &&
      comparisonKey(onFile!.displayName!) !== comparisonKey(body.displayName!);
    if (differentName && !body.existingCustomer) {
      return NextResponse.json(
        {
          error: "This phone number already belongs to a customer.",
          code: "existing_customer",
          existingName: onFile!.displayName,
        },
        { status: 409 },
      );
    }
    const result = await crm.capture({
      organizationId: id,
      source: "manual",
      phoneE164: phone,
      displayName:
        differentName && body.existingCustomer === "keep"
          ? undefined
          : body.displayName || undefined,
      email: body.email || undefined,
      service: body.service || undefined,
      description: body.description || undefined,
      location: body.location || undefined,
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
    if (isCrmError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[crm] create lead", err);
    return NextResponse.json(
      { error: "Could not create the lead." },
      { status: 500 },
    );
  }
}
