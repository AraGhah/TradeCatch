import { NextRequest } from "next/server";
import { z } from "zod";
import { consumePolicy } from "@/lib/rate-limit-policy";
import { tooManyRequests } from "@/lib/rate-limit-response";
import { readJsonBody } from "@/lib/request-body";
import { changePassword } from "@/product/saas/auth/password-auth";
import { authJson, NO_STORE } from "@/product/saas/auth/route-helpers";
import { requireTenantContext } from "@/product/saas/tenant";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().max(256),
  })
  .strict();

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext();
  if (!auth.ok) return authJson({ error: auth.error }, auth.status);

  const budget = await consumePolicy("auth.change-password", {
    subject: auth.ctx.user.id,
  });
  if (!budget.allowed)
    return tooManyRequests(budget, { error: "rate_limited" }, NO_STORE);

  const read = await readJsonBody(request, 4_096);
  if (!read.ok) return authJson({ error: read.error }, read.status);

  const parsed = bodySchema.safeParse(read.data);
  if (!parsed.success) return authJson({ error: "invalid_input" }, 400);

  try {
    const result = await changePassword({
      user: auth.ctx.user,
      currentSessionId: auth.ctx.session.id,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    });
    if (result.ok) return authJson({ ok: true });
    if (result.error === "weak_password") {
      return authJson({ error: "weak_password", problem: result.problem }, 422);
    }
    const status =
      result.error === "rate_limited"
        ? 429
        : result.error === "wrong_password"
          ? 403
          : 400;
    return authJson({ error: result.error }, status);
  } catch {
    console.error("[auth/change-password] request failed");
    return authJson({ error: "unavailable" }, 503);
  }
}
