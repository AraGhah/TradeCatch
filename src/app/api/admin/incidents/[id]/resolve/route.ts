import { adminReply, guardAdmin } from "@/lib/admin-route";
import { safeErrorResponse } from "@/lib/api-error";
import { ReliabilityError } from "@/product/reliability/service";
import { getReliabilityService } from "@/product/reliability/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** Closes an incident by hand. Recorded against the administrator. Safe to repeat. */
export async function POST(request: Request, { params }: Params) {
  const guard = await guardAdmin(request, "admin.manage");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  try {
    const incident = await getReliabilityService().resolve(
      id.slice(0, 120),
      guard.access.actor.label,
    );
    return adminReply({ ok: true, incident });
  } catch (error) {
    return safeErrorResponse(error, {
      route: "admin.incidents.resolve",
      request,
      publicErrors: [ReliabilityError],
      fallback: "Failed.",
    });
  }
}
