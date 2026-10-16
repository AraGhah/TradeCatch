import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import { getSchedulingService } from "@/product/scheduling/runtime";
import { SchedulingError } from "@/product/scheduling/service";
import type { AvailabilityRules } from "@/product/scheduling/types";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const rulesSchema = z.object({
  timezone: z.string().min(1),
  days: z.record(z.string(), z.object({ open: z.string(), close: z.string() }).nullable()),
  defaultDurationMinutes: z.number().int().min(15).max(480),
  bufferMinutes: z.number().int().min(0).max(240),
  travelBufferMinutes: z.number().int().min(0).max(240),
  minimumNoticeMinutes: z.number().int().min(0).max(10_080),
  maxAdvanceDays: z.number().int().min(1).max(365),
  maxDailyBookings: z.number().int().min(1).max(100).nullable().optional(),
  holidays: z.array(z.string()).max(100),
});

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "read");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const url = new URL(request.url);
  if (url.searchParams.get("slots") === "1") {
    const result = await getSchedulingService().availability({
      organizationId: id,
      serviceId: url.searchParams.get("serviceId") || undefined,
      from: url.searchParams.get("from") || undefined,
      until: url.searchParams.get("until") || undefined,
      serviceAddress: url.searchParams.get("address") || undefined,
      technicianId: url.searchParams.get("technicianId") || undefined,
    });
    return NextResponse.json({ ok: true, slots: result.slots });
  }
  const rules = await getSchedulingService().getRules(id);
  return NextResponse.json({ ok: true, rules });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = rulesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid availability." }, { status: 400 });
  try {
    const current = await getSchedulingService().getRules(id);
    const next: AvailabilityRules = {
      ...current,
      ...parsed.data,
      organizationId: id,
      maxDailyBookings: parsed.data.maxDailyBookings ?? undefined,
    };
    const rules = await getSchedulingService().saveRules(next);
    return NextResponse.json({ ok: true, rules });
  } catch (error) {
    if (error instanceof SchedulingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
