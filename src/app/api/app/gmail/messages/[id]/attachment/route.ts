import { NextRequest, NextResponse } from "next/server";
import { toGmailError } from "@/product/gmail/errors";
import { attachmentDisposition } from "@/product/gmail/http";
import {
  openGmailTokens,
  readGmailEnv,
  sealGmailTokens,
} from "@/product/gmail/oauth";
import { getGmailStore } from "@/product/gmail/runtime";
import { downloadGmailAttachment } from "@/product/gmail/sync";
import { requireTenantContext } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const MAX_BYTES = 25 * 1024 * 1024;

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireTenantContext();
  if (!auth.ok)
    return NextResponse.json(
      { error: "unauthorized" },
      { status: auth.status },
    );
  const { id } = await params;
  const part = request.nextUrl.searchParams.get("part") || "";
  const { organization, user } = auth.ctx;
  const env = readGmailEnv();
  const store = getGmailStore();

  // Ownership is checked against the stored message, so a guessed id from
  // another user's mailbox is a plain 404.
  const message = await store.getMessage(organization.id, user.id, id);
  const attachment = message?.attachments.find(
    (item) => item.attachmentId === part,
  );
  if (!message || !attachment)
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (attachment.size > MAX_BYTES)
    return NextResponse.json({ error: "too_large" }, { status: 413 });

  const account = await store.getAccount(organization.id, user.id);
  if (!account?.tokenCiphertext || account.status !== "connected") {
    return NextResponse.json({ error: "needs_reconnect" }, { status: 409 });
  }
  try {
    const data = await downloadGmailAttachment({
      tokens: openGmailTokens(account.tokenCiphertext, env),
      env,
      gmailId: message.gmailId,
      attachment,
      onTokens: async (tokens) => {
        await store.updateAccount(account.id, {
          tokenCiphertext: sealGmailTokens(tokens, env),
        });
      },
    });
    if (!data)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": attachmentDisposition(attachment.filename),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const failure = toGmailError(error);
    if (failure.kind === "needs_reconnect") {
      await store.updateAccount(account.id, {
        status: "needs_reconnect",
        tokenCiphertext: null,
        lastError: "needs_reconnect",
      });
      return NextResponse.json({ error: "needs_reconnect" }, { status: 409 });
    }
    return NextResponse.json(
      { error: failure.kind },
      { status: failure.kind === "rate_limited" ? 429 : 502 },
    );
  }
}
