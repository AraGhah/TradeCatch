import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { listRecoveryRequestsForAdmin } from "@/product/saas/auth/account-recovery";

export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "no-store, private" } as const;

/**
 * Recovery requests for the admin desk. Named administrators only (signed in,
 * MFA, admin token): the shared ops secret cannot read or act on recovery,
 * because every step must be attributable to a person.
 */
export async function GET(request: NextRequest) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status, headers: PRIVATE },
    );
  if (access.via !== "session")
    return NextResponse.json(
      { error: "A signed-in administrator is required." },
      { status: 403, headers: PRIVATE },
    );
  try {
    const requests = await listRecoveryRequestsForAdmin();
    return NextResponse.json({ ok: true, requests }, { headers: PRIVATE });
  } catch {
    return NextResponse.json(
      { error: "Recovery requests are unavailable." },
      { status: 503, headers: PRIVATE },
    );
  }
}
