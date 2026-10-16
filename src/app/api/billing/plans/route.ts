import { NextResponse } from "next/server";
import { listPlanDefinitions } from "@/product/billing/plans";

export const dynamic = "force-dynamic";

/** Public catalog of TradeCatch plans (prices + features). No secrets. */
export async function GET() {
  const plans = listPlanDefinitions().map((plan) => ({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    currency: plan.currency,
    monthlyPriceCents: plan.monthlyPriceCents,
    annualPriceCents: plan.annualPriceCents,
    setupFeeCents: plan.setupFeeCents,
    trialDays: plan.trialDays,
    features: plan.features,
    allowances: plan.allowances,
    overageRatesCents: plan.overageRatesCents,
    usagePolicy: plan.usagePolicy,
    employeeLimit: plan.employeeLimit,
    taxesNote: plan.taxesNote,
    cancellationNote: plan.cancellationNote,
  }));
  return NextResponse.json({ ok: true, plans, currency: "cad" });
}
