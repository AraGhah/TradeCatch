import { NextRequest } from "next/server";
import { z } from "zod";
import { getClientIp, rateLimitAsync } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/request-body";
import { passwordLogin } from "@/product/saas/auth/password-auth";
import { authJson, signedInResponse } from "@/product/saas/auth/route-helpers";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    email: z.string().trim().email().max(200),
    password: z.string().min(1).max(256),
    locale: z.enum(["en", "fr"]).default("en"),
    /** The page they were heading to; ignored unless it is one of our own. */
    next: z.string().max(300).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const budget = await rateLimitAsync({
    key: `auth-password:${ip}`,
    limit: ip.startsWith("unknown") ? 200 : 20,
    windowMs: 15 * 60 * 1000,
  });
  if (!budget.allowed) return authJson({ error: "rate_limited" }, 429);

  const read = await readJsonBody(request, 4_096);
  if (!read.ok) return authJson({ error: read.error }, read.status);

  const parsed = bodySchema.safeParse(read.data);
  if (!parsed.success) return authJson({ error: "invalid_input" }, 400);

  try {
    const result = await passwordLogin({
      email: parsed.data.email,
      password: parsed.data.password,
      userAgent: request.headers.get("user-agent") || undefined,
      ip,
    });
    if (!result.ok) {
      const status =
        result.error === "rate_limited"
          ? 429
          : result.error === "unavailable"
            ? 403
            : 401;
      return authJson({ error: result.error }, status);
    }
    return signedInResponse(
      result.session,
      parsed.data.locale,
      parsed.data.next,
    );
  } catch {
    console.error("[auth/password-login] sign-in unavailable");
    return authJson({ error: "unavailable" }, 503);
  }
}
