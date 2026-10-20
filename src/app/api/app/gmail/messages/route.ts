import { NextRequest, NextResponse } from "next/server";
import { getGmailStore } from "@/product/gmail/runtime";
import { requireTenantContext } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

const PAGE = 30;

function readCursor(
  value: string | null,
): { receivedAt: string; id: string } | undefined {
  if (!value) return undefined;
  const [receivedAt, id] = value.split("|");
  if (!receivedAt || !id || !Number.isFinite(Date.parse(receivedAt)))
    return undefined;
  return { receivedAt, id };
}

export async function GET(request: NextRequest) {
  const auth = await requireTenantContext();
  if (!auth.ok)
    return NextResponse.json(
      { error: "unauthorized" },
      { status: auth.status },
    );
  const params = request.nextUrl.searchParams;
  const filter = params.get("filter");
  const { organization, user } = auth.ctx;
  const store = getGmailStore();

  // One extra row tells the client whether another page exists.
  const rows = await store.listMessages(organization.id, user.id, {
    q: (params.get("q") || "").slice(0, 200),
    unread: filter === "unread",
    important: filter === "customers",
    attachments: filter === "attachments",
    before: readCursor(params.get("before")),
    limit: PAGE + 1,
  });
  const messages = rows.slice(0, PAGE);
  const last = messages[messages.length - 1];
  return NextResponse.json(
    {
      messages,
      next: rows.length > PAGE && last ? `${last.receivedAt}|${last.id}` : null,
      unread: await store.countUnread(organization.id, user.id),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
