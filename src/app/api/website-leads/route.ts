import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hashToken } from "@/product/saas/ids";
import { getSaasStore } from "@/product/saas/runtime";
import { orgHasFeature } from "@/product/saas/entitlements";
import { rateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { getStarterStore } from "@/product/starter/runtime";
import { getStarterServices } from "@/product/starter/org-context";
import {
  looksLikeE164,
  resolveBusinessNameForOrganization,
  resolveSmsFromForOrganization,
} from "@/product/starter/org-context";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().min(8).max(32).optional(),
  message: z.string().trim().max(2000).optional(),
  serviceRequested: z.string().trim().max(200).optional(),
  sourceUrl: z.string().url().max(500).optional(),
  locale: z.enum(["en", "fr"]).optional(),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
  consentAt: z.string().datetime().optional(),
  consentWording: z.string().trim().max(500).optional(),
  sendOpeningSms: z.boolean().optional(),
});

function extractApiKey(request: NextRequest): string | null {
  const header = request.headers.get("x-tradecatch-key")?.trim();
  if (header) return header;
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() || null;
  }
  return null;
}

/**
 * Public website lead capture for contractor orgs (API key auth).
 * Not the marketing book-audit form.
 */
export async function POST(request: NextRequest) {
  const apiKey = extractApiKey(request);
  if (!apiKey) {
    return NextResponse.json({ error: "API key required." }, { status: 401 });
  }

  const ip = getClientIp(request);
  const { allowed } = await rateLimitAsync({
    key: `website-lead:${hashToken(apiKey).slice(0, 16)}:${ip}`,
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const organizationId = await getStarterStore().findOrgIdByApiKeyHash(
    hashToken(apiKey),
  );
  if (!organizationId) {
    return NextResponse.json({ error: "Invalid API key." }, { status: 401 });
  }

  const org = await getSaasStore().getOrganization(organizationId);
  if (!org || org.status !== "active") {
    return NextResponse.json({ error: "Organization unavailable." }, { status: 403 });
  }
  if (!orgHasFeature(org.plan, "WEBSITE_LEAD_CAPTURE")) {
    return NextResponse.json(
      { error: "Website lead capture is not on this plan.", feature: "WEBSITE_LEAD_CAPTURE" },
      { status: 402 },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const data = parsed.data;
  if (!data.phone && !data.email && !data.message) {
    return NextResponse.json(
      { error: "Provide at least phone, email, or message." },
      { status: 400 },
    );
  }

  let phoneE164 = data.phone?.trim();
  if (phoneE164) {
    if (!phoneE164.startsWith("+")) {
      phoneE164 = `+${phoneE164.replace(/\D/g, "")}`;
    }
    if (!looksLikeE164(phoneE164)) {
      return NextResponse.json(
        { error: "phone must be E.164 (e.g. +15145551234)." },
        { status: 400 },
      );
    }
  }

  const smsFrom = phoneE164
    ? await resolveSmsFromForOrganization(organizationId)
    : null;
  const businessName = await resolveBusinessNameForOrganization(organizationId);
  const services = getStarterServices();

  const result = await services.ingestWebsiteLead({
    organizationId,
    businessName,
    locale: data.locale ?? "en",
    name: data.name,
    email: data.email,
    phoneE164,
    message: data.message,
    serviceRequested: data.serviceRequested,
    sourceUrl: data.sourceUrl,
    idempotencyKey: data.idempotencyKey,
    consentAt: data.consentAt,
    consentWording: data.consentWording,
    smsFromE164: smsFrom ?? undefined,
    sendOpeningSms: data.sendOpeningSms !== false && Boolean(smsFrom),
    enableOwnerNotify: orgHasFeature(org.plan, "BUSINESS_NOTIFICATIONS"),
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL?.trim(),
  });

  return NextResponse.json({
    ok: true,
    id: result.lead.id,
    duplicate: Boolean(result.duplicate),
    smsSent: result.smsSent,
    status: result.lead.status,
  });
}
