import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sessionCookieOptions } from "@/product/saas/auth/magic-link";
import { SESSION_COOKIE } from "@/product/saas/auth/session-token";
import { getSaasStore } from "@/product/saas/runtime";
import { readSessionClaimsFromCookies } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

export async function POST() {
  const { claims } = await readSessionClaimsFromCookies();
  if (claims) {
    await getSaasStore().revokeSession(claims.sid, new Date().toISOString());
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { ...sessionCookieOptions(0), maxAge: 0 });

  return NextResponse.json({ ok: true });
}
