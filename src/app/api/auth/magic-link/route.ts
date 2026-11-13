import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/request-body";
import { z } from "zod";
import { getClientIp } from "@/lib/rate-limit";
import { consumePolicy } from "@/lib/rate-limit-policy";
import { tooManyRequests } from "@/lib/rate-limit-response";
import { requestMagicLink } from "@/product/saas/auth/magic-link";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    email: z.string().trim().email().max(200),
    locale: z.enum(["en", "fr"]).default("en"),
    next: z.string().max(300).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const budget = await consumePolicy("auth.magic-link", { ip });
  if (!budget.allowed) {
    return tooManyRequests(budget, {
      error: "Too many requests. Please try again later.",
    });
  }

  const read = await readJsonBody(request, 4_096);
  if (!read.ok)
    return NextResponse.json({ error: read.error }, { status: read.status });

  const parsed = bodySchema.safeParse(read.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    request.nextUrl.origin;

  let result: Awaited<ReturnType<typeof requestMagicLink>>;
  try {
    result = await requestMagicLink({
      email: parsed.data.email,
      locale: parsed.data.locale,
      origin,
      next: parsed.data.next,
    });
  } catch (err) {
    console.error("[auth/magic-link] request failed", err);
    return NextResponse.json({ ok: true });
  }

  if (!result.ok) {
    console.error("[auth/magic-link] request failed", result.error);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({
    ok: true,
    ...(result.devToken ? { devToken: result.devToken } : {}),
  });
}
