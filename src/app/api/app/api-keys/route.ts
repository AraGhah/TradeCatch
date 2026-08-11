import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  forbiddenFeatureResponse,
  requireTenantContext,
  tenantHasFeature,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import { hashToken, randomToken } from "@/product/saas/ids";
import { getStarterStore } from "@/product/starter/runtime";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
});

/**
 * Create a website-capture API key for the current org.
 * Plaintext token is returned once — store hashes only.
 */
export async function POST(request: NextRequest) {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);
  if (!tenantHasFeature(auth.ctx, "WEBSITE_LEAD_CAPTURE")) {
    return forbiddenFeatureResponse("WEBSITE_LEAD_CAPTURE");
  }

  let json: unknown = {};
  try {
    json = await request.json();
  } catch {
    json = {};
  }
  const parsed = createSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const token = randomToken(24);
  const row = await getStarterStore().createOrgApiKey({
    organizationId: auth.ctx.organization.id,
    tokenHash: hashToken(token),
    label: parsed.data.label ?? "website",
  });

  return NextResponse.json({
    ok: true,
    id: row.id,
    token,
    hint: "Store this token now — it will not be shown again.",
    usage: {
      header: "X-TradeCatch-Key",
      endpoint: "POST /api/website-leads",
    },
  });
}
