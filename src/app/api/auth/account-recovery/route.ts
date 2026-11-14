import { NextRequest } from "next/server";
import { z } from "zod";
import { getClientIp } from "@/lib/rate-limit";
import { consumePolicy } from "@/lib/rate-limit-policy";
import { tooManyRequests } from "@/lib/rate-limit-response";
import { readJsonBody } from "@/lib/request-body";
import { submitRecoveryRequest } from "@/product/saas/auth/account-recovery";
import { authJson, NO_STORE } from "@/product/saas/auth/route-helpers";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    accountEmail: z.string().trim().email().max(200),
    contactEmail: z.string().trim().email().max(200),
    contactName: z.string().trim().min(2).max(120),
    businessName: z.string().trim().min(2).max(160),
    phone: z
      .string()
      .trim()
      .max(40)
      .regex(/^[0-9+().\s-]*$/)
      .optional(),
    details: z.string().trim().min(10).max(2000),
    locale: z.enum(["en", "fr"]).default("en"),
    /** Left empty by people; filled by bots that complete every field. */
    website: z.string().max(200).optional(),
  })
  .strict();

/**
 * A customer who lost access to their account email asks support for help.
 * Public, rate limited, and always the same answer: it never says whether an
 * account exists and never changes an account by itself.
 */
export async function POST(request: NextRequest) {
  const budget = await consumePolicy("auth.account-recovery", {
    ip: getClientIp(request),
  });
  if (!budget.allowed)
    return tooManyRequests(budget, { error: "rate_limited" }, NO_STORE);

  const read = await readJsonBody(request, 8_192);
  if (!read.ok) return authJson({ error: read.error }, read.status);
  const parsed = bodySchema.safeParse(read.data);
  if (!parsed.success) return authJson({ error: "invalid_input" }, 400);
  if (parsed.data.website) return authJson({ ok: true });

  try {
    const { website: _honeypot, ...input } = parsed.data;
    void _honeypot;
    await submitRecoveryRequest(input);
    return authJson({ ok: true });
  } catch {
    console.error("[auth/account-recovery] request not recorded");
    return authJson({ error: "unavailable" }, 503);
  }
}
