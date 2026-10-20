import { NextRequest, NextResponse } from "next/server";
import { BodyTooLargeError, readBodyText } from "@/lib/request-body";
import { verifyStripeSignature } from "@/product/security/stripe-webhook";
import {
  BILLING_EVENTS,
  stripeEventSchema,
  synchronizeStripeBilling,
} from "@/product/saas/stripe-billing";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let payload: string;
  try {
    payload = await readBodyText(request, 512 * 1024);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return NextResponse.json(
        { error: "Payload too large." },
        { status: 413 },
      );
    }
    throw error;
  }
  const signature = request.headers.get("stripe-signature") || "";
  const liveSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const testSecret = process.env.STRIPE_TEST_WEBHOOK_SECRET?.trim();
  const liveSigned =
    !!liveSecret && verifyStripeSignature(payload, signature, liveSecret);
  const testSigned =
    !!testSecret && verifyStripeSignature(payload, signature, testSecret);
  if (!liveSigned && !testSigned) {
    return NextResponse.json(
      { error: "Invalid webhook signature." },
      { status: 401 },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return NextResponse.json(
      { error: "Invalid webhook payload." },
      { status: 400 },
    );
  }
  const result = stripeEventSchema.safeParse(parsed);
  if (!result.success)
    return NextResponse.json(
      { error: "Invalid webhook payload." },
      { status: 400 },
    );
  const event = result.data;
  if ((event.livemode && !liveSigned) || (!event.livemode && !testSigned)) {
    return NextResponse.json(
      { error: "Webhook mode mismatch." },
      { status: 401 },
    );
  }
  if (!BILLING_EVENTS.has(event.type))
    return NextResponse.json({ ok: true, ignored: true });
  try {
    const outcome = await synchronizeStripeBilling(event);
    return NextResponse.json({ ok: true, ...outcome, type: event.type });
  } catch {
    // No receipt survives a failed transaction. A non-2xx asks Stripe to retry.
    console.error("[stripe] Billing synchronization failed", {
      eventId: event.id,
      type: event.type,
    });
    return NextResponse.json(
      { error: "Billing synchronization unavailable. Retry later." },
      { status: 503 },
    );
  }
}
