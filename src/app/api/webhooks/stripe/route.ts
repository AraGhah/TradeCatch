import { NextRequest, NextResponse } from "next/server";
import { getWebhookHandler } from "@/product/billing/runtime";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook endpoint.
 * Verifies Stripe-Signature against the raw body. No session auth.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  let handler;
  try {
    handler = getWebhookHandler();
  } catch {
    return NextResponse.json(
      { error: "Stripe is not configured." },
      { status: 503 },
    );
  }

  const verified = await handler.verifyAndParse(rawBody, signature);
  if (!verified.ok) {
    return NextResponse.json(
      { error: verified.error },
      { status: verified.status },
    );
  }

  try {
    const result = await handler.processEvent(verified.event);
    return NextResponse.json({
      ok: true,
      duplicate: result.duplicate,
      businessId: result.businessId,
    });
  } catch (err) {
    console.error("[stripe-webhook]", err);
    return NextResponse.json(
      { error: "Webhook processing failed." },
      { status: 500 },
    );
  }
}
