import { NextRequest } from "next/server";
import { z } from "zod";
import { getClientIp } from "@/lib/rate-limit";
import { consumePolicy } from "@/lib/rate-limit-policy";
import { tooManyRequests } from "@/lib/rate-limit-response";
import { readJsonBody } from "@/lib/request-body";
import { requestPasswordReset } from "@/product/saas/auth/password-auth";
import {
  authJson,
  authOrigin,
  NO_STORE,
} from "@/product/saas/auth/route-helpers";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    email: z.string().trim().email().max(200),
    locale: z.enum(["en", "fr"]).default("en"),
  })
  .strict();

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const budget = await consumePolicy("auth.forgot-password", { ip });
  if (!budget.allowed)
    return tooManyRequests(budget, { error: "rate_limited" }, NO_STORE);

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
