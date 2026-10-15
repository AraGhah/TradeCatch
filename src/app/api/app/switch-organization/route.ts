import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { newId } from "@/product/saas/ids";
import { getSaasStore } from "@/product/saas/runtime";
import {
  getAuthSecret,
  requireTenantContext,
  unauthorizedTenantResponse,
} from "@/product/saas/tenant";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  signSessionClaims,
} from "@/product/saas/auth/session-token";
import { isPlatformAdminUser } from "@/product/saas/platform-admin";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    organizationId: z.string().trim().min(3).max(80),
  })
  .strict();

/**
 * Switch the active tenant session to another organization the user belongs to.
 * Platform admins may also switch into any demo business they do not yet own
 * by receiving a temporary owner membership (demo only).
 */
export async function POST(request: NextRequest) {
  const auth = await requireTenantContext();
  if (!auth.ok) return unauthorizedTenantResponse(auth.error);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const saas = getSaasStore();
  const target = await saas.getOrganization(parsed.data.organizationId);
  if (!target || target.status !== "active") {
    return NextResponse.json({ error: "Business not found." }, { status: 404 });
  }

  let membership = await saas.getMembership(target.id, auth.ctx.user.id);
  if (!membership) {
    if (isPlatformAdminUser(auth.ctx.user) && target.accountType === "demo") {
      membership = await saas.addMembership({
        organizationId: target.id,
        userId: auth.ctx.user.id,
        role: "owner",
      });
    } else {
      return NextResponse.json(
        { error: "Not authorized for this business." },
        { status: 403 },
      );
    }
  }

  const secret = getAuthSecret();
  if (!secret) {
    return NextResponse.json({ error: "Auth is not configured." }, { status: 500 });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  await saas.revokeSession(auth.ctx.session.id, now.toISOString());

  const session = {
    id: newId("ses"),
    userId: auth.ctx.user.id,
    organizationId: target.id,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  };
  await saas.createSession(session);

  const token = await signSessionClaims(
    {
      sid: session.id,
      uid: auth.ctx.user.id,
      oid: target.id,
      plan: target.plan,
      exp: Math.floor(expiresAt.getTime() / 1000),
    },
    secret,
  );

  const response = NextResponse.json({
    ok: true,
    organizationId: target.id,
    organizationName: target.name,
    membershipRole: membership.role,
  });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return response;
}
