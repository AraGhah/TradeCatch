import { NextRequest, NextResponse } from "next/server";
import { verifyStripeSignature } from "@/product/security/stripe-webhook";
import { getSecurityService } from "@/product/security/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") || "";
  if (!secret || !verifyStripeSignature(payload, signature, secret)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }
  let event: { id?: string; type?: string };
  try {
    event = JSON.parse(payload) as { id?: string; type?: string };
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }
  if (!event.id || !event.type) return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  const fresh = await getSecurityService().acceptWebhook("stripe", event.id);
  return NextResponse.json({ ok: true, duplicate: !fresh, type: event.type });
}
