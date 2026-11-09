import { NextRequest } from "next/server";
import { z } from "zod";
import { getClientIp, rateLimitAsync } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/request-body";
import { requestPasswordReset } from "@/product/saas/auth/password-auth";
import { authJson, authOrigin } from "@/product/saas/auth/route-helpers";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    email: z.string().trim().email().max(200),
    locale: z.enum(["en", "fr"]).default("en"),
  })
  .strict();

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const budget = await rateLimitAsync({
    key: `auth-forgot:${ip}`,
    limit: ip.startsWith("unknown") ? 100 : 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!budget.allowed) return authJson({ error: "rate_limited" }, 429);

  const read = await readJsonBody(request, 4_096);
  if (!read.ok) return authJson({ error: read.error }, read.status);

  const parsed = bodySchema.safeParse(read.data);
  if (!parsed.success) return authJson({ error: "invalid_input" }, 400);

  try {
    const result = await requestPasswordReset({
      email: parsed.data.email,
      locale: parsed.data.locale,
      origin: authOrigin(request),
    });
    // The same answer whether or not the email has an account.
    return authJson({
      ok: true,
      ...(result.devToken ? { devToken: result.devToken } : {}),
    });
  } catch {
    console.error("[auth/forgot-password] request failed");
    return authJson({ ok: true });
  }
}
