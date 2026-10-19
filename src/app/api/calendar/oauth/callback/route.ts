import { NextRequest, NextResponse } from "next/server";
import { readOAuthState, exchangeGoogleCode, sealTokens, listGoogleCalendars } from "@/product/scheduling/google";
import { getSchedulingStore } from "@/product/scheduling/runtime";
import { requireTenantContext } from "@/product/saas/tenant";
import { allows } from "@/product/security/permissions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  const back = `${site}/app/settings/calendar`;
  if (oauthError || !code || !state) {
    return NextResponse.redirect(`${back}?calendar=denied`);
  }
  const parsed = readOAuthState(state);
  if (!parsed) return NextResponse.redirect(`${back}?calendar=expired`);
  const tenant = await requireTenantContext();
  if (!tenant.ok) return NextResponse.redirect(`${back}?calendar=forbidden`);
  const { ctx } = tenant;
  // The state was minted for one person acting on one business. Someone else who
  // is handed the link (or a replay after a role change) must not attach a calendar.
  if (
    ctx.user.id !== parsed.userId ||
    (ctx.organization.id !== parsed.organizationId && !ctx.isPlatformAdmin) ||
    !allows(ctx.membership.role, "manage_settings", ctx.isPlatformAdmin)
  ) {
    return NextResponse.redirect(`${back}?calendar=forbidden`);
  }
  try {
    const tokens = await exchangeGoogleCode(code);
    const calendars = await listGoogleCalendars(tokens);
    await getSchedulingStore().saveConnection({
      organizationId: parsed.organizationId,
      provider: "google",
      status: "error",
      lastError: "select_calendar",
      accountEmail: tokens.email,
      tokenCiphertext: sealTokens(tokens),
      expiresAt: tokens.expiresAt,
      scope: "calendar.events calendar.freebusy calendar.calendarlist.readonly",
    });
    const hint = calendars[0] ? `&calendarId=${encodeURIComponent(calendars[0].id)}` : "";
    return NextResponse.redirect(`${back}?calendar=choose${hint}`);
  } catch {
    return NextResponse.redirect(`${back}?calendar=error`);
  }
}
