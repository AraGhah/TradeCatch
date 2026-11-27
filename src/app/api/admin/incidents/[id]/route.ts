import { adminReply, guardAdmin } from "@/lib/admin-route";
import { getReliabilityService } from "@/product/reliability/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/**
 * One incident with its history (opened, alerted, acknowledged, escalated,
 * resolved), the alert emails sent for it and the recent errors behind it.
 * Alert delivery failures carry a short code only, and recorded error details
 * are redacted when they are stored.
 */
export async function GET(request: Request, { params }: Params) {
  const guard = await guardAdmin(request, "admin.read");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const detail = await getReliabilityService().incidentDetail(id.slice(0, 120));
  if (!detail) return adminReply({ error: "Incident not found." }, 404);
  return adminReply({ ok: true, ...detail });
}
