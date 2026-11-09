import { NextRequest } from "next/server";
import { z } from "zod";
import { getClientIp, rateLimitAsync } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/request-body";
import { completePassword } from "@/product/saas/auth/password-auth";
import {
  authJson,
  localePath,
  signedInResponse,
} from "@/product/saas/auth/route-helpers";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    token: z.string().trim().min(20).max(100),
    password: z.string().max(256),
    locale: z.enum(["en", "fr"]).default("en"),
  })
  .strict();

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const budget = await rateLimitAsync({
    key: `auth-set-password:${ip}`,
    limit: ip.startsWith("unknown") ? 200 : 20,
    windowMs: 15 * 60 * 1000,
  });
  if (!budget.allowed) return authJson({ error: "rate_limited" }, 429);

  const read = await readJsonBody(request, 4_096);
  if (!read.ok) return authJson({ error: read.error }, read.status);

  const parsed = bodySchema.safeParse(read.data);
  if (!parsed.success) return authJson({ error: "invalid_input" }, 400);

  try {
    const result = await completePassword({
      rawToken: parsed.data.token,
      password: parsed.data.password,
      userAgent: request.headers.get("user-agent") || undefined,
      ip,
    });
    if (!result.ok) {
      return result.error === "weak_password"
        ? authJson({ error: "weak_password", problem: result.problem }, 422)
        : authJson({ error: "invalid_link" }, 400);
    }
    if (result.session) {
      return signedInResponse(result.session, parsed.data.locale);
    }
    // The password is saved but this browser could not be signed in: send them to sign in.
    return authJson({
      ok: true,
      next: localePath(
        parsed.data.locale,
        "/login?notice=password_saved",
        "/fr/connexion?notice=password_saved",
      ),
    });
  } catch {
    console.error("[auth/set-password] request failed");
    return authJson({ error: "unavailable" }, 503);
  }
}
