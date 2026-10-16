import { NextResponse } from "next/server";
import { requireSchedulingAccess } from "@/product/scheduling/access";
import { openTokens, revokeGoogleToken } from "@/product/scheduling/google";
import { getSchedulingService, getSchedulingStore } from "@/product/scheduling/runtime";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const access = await requireSchedulingAccess(id, "write");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const connection = await getSchedulingStore().getConnection(id);
  if (connection?.tokenCiphertext) {
    try {
      const tokens = openTokens(connection.tokenCiphertext);
      await revokeGoogleToken(tokens.accessToken);
    } catch {
      // Revocation is best-effort. Local access is removed either way.
    }
  }
  await getSchedulingService().disconnect(id);
  return NextResponse.json({ ok: true, calendar: await getSchedulingService().connectionStatus(id) });
}
