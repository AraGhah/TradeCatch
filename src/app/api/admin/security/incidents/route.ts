import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { getSecurityService } from "@/product/security/runtime";

export const dynamic = "force-dynamic";

const schema = z.object({
  organizationId: z.string().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  summary: z.string().min(3).max(240),
});

export async function GET(request: NextRequest) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const incidents = await getSecurityService().listIncidents();
  return NextResponse.json({
    ok: true,
    incidents: incidents.map((row) => ({ id: row.id, severity: row.severity, status: row.status, summary: row.summary, createdAt: row.createdAt })),
  });
}

export async function POST(request: NextRequest) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid incident." }, { status: 400 });
  const result = await getSecurityService().openIncident(parsed.data);
  return NextResponse.json({ ok: true, incident: result.incident, procedure: result.procedure });
}
