import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { loadPlatformSnapshot } from "@/product/admin/platform-snapshot";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const snapshot = await loadPlatformSnapshot();
  return NextResponse.json({
    ok: true,
    businesses: snapshot.businesses,
    activeSubscriptions: snapshot.activeSubscriptions,
    mrr: snapshot.mrr,
    leads: snapshot.leads,
    calls: snapshot.calls,
    aiCompleted: snapshot.aiCompleted,
    appointments: snapshot.appointments,
    stripeConfigured: snapshot.stripeConfigured,
    health: snapshot.health,
  });
}
