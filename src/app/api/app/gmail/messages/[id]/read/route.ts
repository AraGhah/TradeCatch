import { NextRequest, NextResponse } from "next/server";
import { forbiddenOrigin, isSameOrigin } from "@/product/gmail/http";
import { getGmailStore } from "@/product/gmail/runtime";
import { requireTenantContext } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Read state kept inside TradeCatch. The Gmail permission is read-only, so
 * this never changes anything in the person's actual mailbox.
 */
export async function POST(request: NextRequest, { params }: Params) {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  const auth = await requireTenantContext();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { read?: unknown };
  const read = body.read !== false;
  const { organization, user } = auth.ctx;
  const store = getGmailStore();
  const updated = await store.setRead(organization.id, user.id, id, read);
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, unread: await store.countUnread(organization.id, user.id) });
}
