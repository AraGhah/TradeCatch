import { NextRequest, NextResponse } from "next/server";
import { createGoogleClient } from "@/product/scheduling/gcal/client";
import {
  readOAuthState,
  exchangeGoogleCode,
  revokeGoogleToken,
  scopesSatisfied,
  sealTokens,
} from "@/product/scheduling/google";
import {
  getSchedulingService,
  getSchedulingStore,
} from "@/product/scheduling/runtime";
import { requireTenantContext } from "@/product/saas/tenant";
import { allows } from "@/product/security/permissions";
import { hasGoogleCalendarPilot } from "@/product/scheduling/availability";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const site = (
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  const back = `${site}/app/settings/calendar`;
  // The owner pressed "Cancel" on Google's consent screen (or Google refused).
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
    if (!(await hasGoogleCalendarPilot(parsed.organizationId)))
      return NextResponse.redirect(`${back}?calendar=pilot_required`);
    const exchanged = await exchangeGoogleCode(code);
    if (!exchanged.ok) return NextResponse.redirect(`${back}?calendar=error`);
    const tokens = exchanged.tokens;
    // The owner can untick a permission on Google's screen, and without a
    // refresh token the connection would die within the hour. Either way the
    // grant is useless: hand it back to Google instead of keeping it.
    if (!scopesSatisfied(tokens.scope) || !tokens.refreshToken) {
      await revokeGoogleToken(tokens);
      return NextResponse.redirect(`${back}?calendar=scope`);
    }
    const listed = await createGoogleClient({ tokens }).listCalendars();
    if (!listed.ok) {
      await revokeGoogleToken(tokens);
      return NextResponse.redirect(`${back}?calendar=error`);
    }
    const store = getSchedulingStore();
    const previous = await store.getConnection(parsed.organizationId);
    // The same account reconnecting (after a revocation, say) gets its calendar
    // and settings back without being asked again.
    const keep = previous?.calendarId
      ? listed.calendars.find((entry) => entry.id === previous.calendarId)
      : undefined;
    const sealed = sealTokens({ ...tokens, email: listed.accountEmail });
    await store.saveConnection({
      organizationId: parsed.organizationId,
      provider: "google",
      status: keep ? "connected" : "error",
      lastError: keep ? undefined : "select_calendar",
      calendarId: keep?.id,
      calendarSummary: keep?.summary,
      accountEmail: listed.accountEmail,
      tokenCiphertext: sealed,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
      eventDetail: previous?.eventDetail,
      cancelPolicy: previous?.cancelPolicy,
      connectedAt: previous?.connectedAt,
    });
    if (keep) {
      await getSchedulingService().selectCalendar(
        parsed.organizationId,
        keep.id,
        keep.summary,
      );
      return NextResponse.redirect(`${back}?calendar=connected`);
    }
    const hint = listed.calendars[0]
      ? `&calendarId=${encodeURIComponent(listed.calendars[0].id)}`
      : "";
    return NextResponse.redirect(`${back}?calendar=choose${hint}`);
  } catch {
    return NextResponse.redirect(`${back}?calendar=error`);
  }
}
