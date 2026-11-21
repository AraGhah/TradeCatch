import { NextRequest } from "next/server";
import { z } from "zod";
import { getClientIp } from "@/lib/rate-limit";
import { consumePolicy } from "@/lib/rate-limit-policy";
import { tooManyRequests } from "@/lib/rate-limit-response";
import { readJsonBody } from "@/lib/request-body";
import { inspectPasswordToken } from "@/product/saas/auth/password-auth";
import { authJson, NO_STORE } from "@/product/saas/auth/route-helpers";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({ token: z.string().trim().min(20).max(100) })
  .strict();

/**
 * Tells the set-password page whether its link can still be used, without
 * spending it. The link's secret arrives in the body: it is kept out of the
 * page's URL path and query (and so out of access logs) by living in the
 * fragment of the emailed address, which the browser never sends anywhere.
 * The answer is only "usable" or "not usable"; it never says which.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const budget = await consumePolicy("auth.set-password-check", { ip });
  if (!budget.allowed)
    return tooManyRequests(budget, { error: "rate_limited" }, NO_STORE);

  const read = await readJsonBody(request, 4_096);
  if (!read.ok) return authJson({ error: read.error }, read.status);

  const parsed = bodySchema.safeParse(read.data);
  if (!parsed.success) return authJson({ error: "invalid_input" }, 400);

  try {
    const check = await inspectPasswordToken(parsed.data.token);
    return authJson(
      check.valid ? { valid: true, kind: check.kind } : { valid: false },
    );
  } catch {
    // Not "expired": the check itself could not run, so the page says so and
    // lets the person try again instead of telling them the link is dead.
    console.error("[auth/set-password/check] request failed");
    return authJson({ error: "unavailable" }, 503);
  }
}
