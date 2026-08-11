import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { requestMagicLink } from "@/product/saas/auth/magic-link";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email().max(200),
  locale: z.enum(["en", "fr"]).default("en"),
  /** Pilot onboarding: create a Starter org when the email is new. */
  companyName: z.string().trim().min(2).max(120).optional(),
  plan: z.enum(["starter", "growth"]).optional(),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const { allowed } = await rateLimitAsync({
    key: `auth-magic:${ip}`,
    limit: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    request.nextUrl.origin;

  const result = await requestMagicLink({
    email: parsed.data.email,
    locale: parsed.data.locale,
    origin,
    createOrgIfMissing: parsed.data.companyName
      ? {
          name: parsed.data.companyName,
          plan: parsed.data.plan ?? "starter",
        }
      : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    ...(result.devToken ? { devToken: result.devToken } : {}),
  });
}
