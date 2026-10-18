import { NextRequest } from "next/server";
import { siteRedirect } from "@/product/gmail/http";
import { buildGmailAuthUrl, gmailConfigured, readGmailEnv } from "@/product/gmail/oauth";
import { getGmailStore } from "@/product/gmail/runtime";
import { requireTenantContext } from "@/product/saas/tenant";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get("locale") === "fr" ? "fr" : "en";
  const auth = await requireTenantContext();
  if (!auth.ok) return siteRedirect("/login", locale);
  const env = readGmailEnv();
  if (!gmailConfigured(env)) return siteRedirect("/app/settings", locale, "not_configured");

  const existing = await getGmailStore()
    .getAccount(auth.ctx.organization.id, auth.ctx.user.id)
    .catch(() => null);
  const { url } = buildGmailAuthUrl(
    {
      organizationId: auth.ctx.organization.id,
      userId: auth.ctx.user.id,
      locale,
      loginHint: existing?.email,
    },
    env,
  );
  return NextResponse.redirect(url);
}
