import { NextRequest, NextResponse } from "next/server";
import { forbiddenOrigin, isSameOrigin } from "@/product/gmail/http";
import {
  accessTokenFresh,
  openGmailTokens,
  readGmailEnv,
  refreshGmailTokens,
  revokeGmailToken,
} from "@/product/gmail/oauth";
import { getGmailStore } from "@/product/gmail/runtime";
import { stopGmailWatch } from "@/product/gmail/sync";
import { requireTenantContext } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  const auth = await requireTenantContext();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  const { organization, user } = auth.ctx;
  const env = readGmailEnv();
  const store = getGmailStore();
  const account = await store.getAccount(organization.id, user.id);

  // Tell Google first so the grant also disappears from the person's Google
  // account. Failure here never blocks removing our copy.
  if (account?.tokenCiphertext) {
    try {
      let tokens = openGmailTokens(account.tokenCiphertext, env);
      if (!accessTokenFresh(tokens)) tokens = await refreshGmailTokens(tokens, env);
      await stopGmailWatch(tokens, env).catch(() => undefined);
      await revokeGmailToken(tokens, env);
    } catch {
      // Tokens already revoked or unreadable: nothing left to revoke.
    }
  }
  await store.deleteAccount(organization.id, user.id);
  return NextResponse.json({ ok: true });
}
