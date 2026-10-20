import { NextRequest, NextResponse } from "next/server";
import { requireSameBusiness } from "@/product/security/access";
import { getSaasStore } from "@/product/saas/runtime";
import { canManageAccount } from "@/product/support/access";
import { recordSecurityEvent } from "@/product/security/hooks";
import { enforceRateLimit } from "@/lib/rate-limit-response";
import { buildAccountExport } from "@/product/account-export/archive";
import { accountExportSources } from "@/product/account-export/sources";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const error = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status, headers: privateHeaders });

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSameBusiness(id);
  if (!access.ok) return error(access.error, access.status);
  if (!canManageAccount(access.ctx.membership.role, access.ctx.isPlatformAdmin))
    return error("Insufficient permissions.", 403);
  const limited = await enforceRateLimit({
    scope: "account-export",
    subject: `${id}:${access.ctx.user.id}`,
    limit: 3,
    windowMs: 60 * 60_000,
  });
  if (limited) return limited;
  try {
    const org = await getSaasStore().getOrganization(id);
    if (!org) return error("Business not found.", 404);
    const now = new Date();
    const archive = await buildAccountExport(id, accountExportSources(org), {
      now,
    });
    await recordSecurityEvent({
      organizationId: id,
      actorUserId: access.ctx.user.id,
      action: "account_exported",
      target: id,
      detail: JSON.stringify({
        format: "zip",
        complete: archive.manifest.complete,
        sectionCount: archive.manifest.sections.length,
        failedSources: archive.manifest.sections.filter(
          (s) => s.status === "failed",
        ).length,
        partialSources: archive.manifest.sections.filter(
          (s) => s.status === "partial",
        ).length,
        bytes: archive.bytes.length,
      }),
    });
    return new NextResponse(archive.bytes, {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="tradecatch-account-export-${now.toISOString().slice(0, 10)}.zip"`,
        "Content-Length": String(archive.bytes.byteLength),
        "X-Export-Status": archive.manifest.complete ? "complete" : "partial",
      },
    });
  } catch {
    await recordSecurityEvent({
      organizationId: id,
      actorUserId: access.ctx.user.id,
      action: "account_export_failed",
      target: id,
    });
    return error(
      "The account archive could not be created. Please try again later.",
      503,
    );
  }
}
