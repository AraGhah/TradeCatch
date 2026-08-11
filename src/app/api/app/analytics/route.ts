import { NextRequest, NextResponse } from "next/server";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { getGrowthServices, getGrowthStore } from "@/product/growth";

export const dynamic = "force-dynamic";

function toCsv(rows: Record<string, string | number | undefined | null>[]) {
  if (rows.length === 0) return "empty\n";
  const keys = Object.keys(rows[0]!);
  const escape = (v: string | number | undefined | null) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [
    keys.join(","),
    ...rows.map((r) => keys.map((k) => escape(r[k])).join(",")),
  ].join("\n");
}

export async function GET(request: NextRequest) {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "ADVANCED_ANALYTICS")) {
    return forbiddenFeatureResponse("ADVANCED_ANALYTICS");
  }

  const store = getGrowthStore();
  const orgId = auth.ctx.organization.id;
  const includeRevenue = tenantHasFeature(auth.ctx, "REVENUE_ATTRIBUTION");
  const format = request.nextUrl.searchParams.get("format");

  const [pipeline, appointments, reviews, revenue] = await Promise.all([
    store.listPipeline(orgId),
    store.listAppointments(orgId),
    store.listReviewRequests(orgId),
    includeRevenue ? store.listRevenue(orgId) : Promise.resolve([]),
  ]);

  const analytics = getGrowthServices().computeAdvancedAnalytics({
    pipeline,
    revenue,
    appointments,
    reviews,
  });

  if (format === "csv") {
    const rows = [
      ...pipeline.map((c) => ({
        type: "pipeline",
        id: c.id,
        title: c.title,
        stage: c.stage,
        source: c.source,
        value: c.estimatedValue ?? "",
        phone: c.customerPhoneE164 ?? "",
        updatedAt: c.updatedAt,
      })),
      ...(includeRevenue
        ? revenue.map((r) => ({
            type: "revenue",
            id: r.id,
            title: r.note ?? r.source,
            stage: "",
            source: r.source,
            value: r.amount,
            phone: "",
            updatedAt: r.occurredAt,
          }))
        : []),
    ];
    return new NextResponse(toCsv(rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="tradecatch-analytics-${orgId}.csv"`,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    analytics,
    ...(includeRevenue ? { revenue } : {}),
    exportUrl: "/api/app/analytics?format=csv",
  });
}
