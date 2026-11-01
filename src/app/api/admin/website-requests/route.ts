import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { WEBSITE_REQUEST_STATUSES } from "@/product/website-services/model";
import { getWebsiteRequestService } from "@/product/website-services/runtime";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Every website-service request across all businesses, for platform
 * administrators (MFA session) or the operations secret. These rows hold
 * visitors' contact details, so this is never reachable by a customer.
 */
export async function GET(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers },
    );
  }
  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  if (
    status !== null &&
    !(WEBSITE_REQUEST_STATUSES as readonly string[]).includes(status)
  ) {
    return NextResponse.json(
      { error: "Unknown status." },
      { status: 400, headers },
    );
  }
  const limit = Number(params.get("limit") ?? 100);
  try {
    const requests = await getWebsiteRequestService().listAll({
      status:
        (status as (typeof WEBSITE_REQUEST_STATUSES)[number] | null) ??
        undefined,
      limit: Number.isFinite(limit) ? limit : 100,
    });
    return NextResponse.json({ ok: true, requests }, { headers });
  } catch (error) {
    console.error("[website-requests] admin list failed", error);
    return NextResponse.json(
      { error: "Website requests are unavailable." },
      { status: 503, headers },
    );
  }
}
