import { NextRequest } from "next/server";
import { createId } from "@/lib/id";
import { GmailApiError, toGmailError } from "@/product/gmail/errors";
import { siteRedirect, type GmailNotice } from "@/product/gmail/http";
import {
  exchangeGmailCode,
  readGmailEnv,
  readGmailState,
  sealGmailTokens,
} from "@/product/gmail/oauth";
import { getGmailStore, syncConnectedGmail } from "@/product/gmail/runtime";
import { fetchGmailProfile } from "@/product/gmail/sync";
import { requireTenantContext } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

function noticeFor(error: GmailApiError): GmailNotice {
  if (error.kind === "needs_reconnect") return "denied";
  return error.kind;
}

export async function GET(request: NextRequest) {
  const env = readGmailEnv();
  const stateRaw = request.nextUrl.searchParams.get("state") || "";
  const code = request.nextUrl.searchParams.get("code") || "";
  const state = stateRaw ? readGmailState(stateRaw, env) : null;
  const locale = state?.locale || "en";

  // The user pressed "Cancel" at Google, or the link is stale or forged.
  if (request.nextUrl.searchParams.get("error") || !state || !code) {
    return siteRedirect("/app/settings", locale, "denied");
  }
  const auth = await requireTenantContext();
  if (!auth.ok) return siteRedirect("/login", locale);
  // The state was minted for one person; it cannot attach a mailbox to another.
  if (state.organizationId !== auth.ctx.organization.id || state.userId !== auth.ctx.user.id) {
    return siteRedirect("/app/settings", locale, "denied");
  }

  try {
    const store = getGmailStore();
    const tokens = await exchangeGmailCode(code, env);
    const profile = await fetchGmailProfile(tokens, env);
    const existing = await store.getAccount(state.organizationId, state.userId);
    const now = new Date().toISOString();

    // Reconnecting the same address resumes where it left off. A different
    // address starts clean so the old mailbox's mail never shows under it.
    const sameMailbox = existing?.email?.toLowerCase() === profile.emailAddress.toLowerCase();
    if (existing && !sameMailbox) await store.clearMessages(existing.id);

    await store.saveAccount({
      id: existing?.id || createId("gac"),
      organizationId: state.organizationId,
      userId: state.userId,
      email: profile.emailAddress,
      status: "connected",
      tokenCiphertext: sealGmailTokens(tokens, env),
      historyId: sameMailbox ? existing!.historyId : null,
      watchExpiration: null,
      lastSyncAt: sameMailbox ? existing!.lastSyncAt : null,
      lastAttemptAt: null,
      nextSyncAt: null,
      failureCount: 0,
      lastError: null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });

    const first = await syncConnectedGmail(state.organizationId, state.userId, "manual");
    if (!first.ok && first.error !== "not_connected") {
      return siteRedirect("/app/settings", locale, first.error);
    }
    return siteRedirect("/app/settings", locale, "connected");
  } catch (error) {
    return siteRedirect("/app/settings", locale, noticeFor(toGmailError(error)));
  }
}
