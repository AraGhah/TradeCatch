import { NextRequest, NextResponse } from "next/server";
import { BodyTooLargeError, readBodyText } from "@/lib/request-body";
import {
  billingEventFromWebhook,
  recordBillingEvent,
} from "@/product/admin-console/billing-db";
import { recordFailure } from "@/product/reliability/hooks";
import { verifyStripeSignature } from "@/product/security/stripe-webhook";
import {
  BILLING_EVENTS,
  stripeEventSchema,
  synchronizeStripeBilling,
} from "@/product/saas/stripe-billing";
import {
  REFERRAL_REVERSAL_EVENTS,
  referralPaymentReversed,
} from "@/product/referrals/billing-hooks";
import {
  CHECKOUT_COMPLETED_EVENT,
  checkoutSessionEventSchema,
  synchronizeInstallationCheckout,
} from "@/product/saas/stripe-checkout";

export const dynamic = "force-dynamic";

/**
 * Webhook failures are shown to administrators (System Health). A bad signature
 * is something anyone on the internet can cause, so it is recorded at most once
 * a minute per server instance and at low severity: visible, but it can neither
 * flood storage nor raise a false incident.
 */
const SIGNATURE_RECORD_INTERVAL_MS = 60_000;
let lastSignatureRecordAt = 0;
async function recordRejectedSignature() {
  const now = Date.now();
  if (now - lastSignatureRecordAt < SIGNATURE_RECORD_INTERVAL_MS) return;
  lastSignatureRecordAt = now;
  await recordFailure({
    service: "stripe",
    operation: "webhook.signature",
    errorCode: "invalid_signature",
    severity: "low",
    retryable: false,
    detail: "A webhook delivery failed signature verification.",
  });
}

/** Never fails the webhook: the console record is best effort, Stripe state is the truth. */
async function recordSyncFailure(type: string, eventId: string) {
  await recordFailure({
    service: "stripe",
    operation: `webhook.${type}`,
    errorCode: "sync_failed",
    severity: "high",
    retryable: true,
    detail: `Event ${eventId} could not be synchronized; Stripe will retry.`,
  });
}

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
    // Only a delivery that carried a signature is worth recording; bare probes are noise.
    if (signature) await recordRejectedSignature();
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

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { type?: unknown }).type === CHECKOUT_COMPLETED_EVENT
  ) {
    const result = checkoutSessionEventSchema.safeParse(parsed);
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
    try {
      const outcome = await synchronizeInstallationCheckout(event);
      return NextResponse.json({ ok: true, ...outcome, type: event.type });
    } catch {
      console.error("[stripe] Installation checkout synchronization failed", {
        eventId: event.id,
        type: event.type,
      });
      await recordSyncFailure(event.type, event.id);
      return NextResponse.json(
        { error: "Billing synchronization unavailable. Retry later." },
        { status: 503 },
      );
    }
  }

  // Refunds and disputes only update referral rewards; billing state is untouched.
  // Handled before the billing schema on purpose: a charge with no customer (any
  // non-subscription charge) must be acknowledged, not rejected into Stripe retries.
  // Subscribe the endpoint to these two events in Stripe; see docs/REFERRAL_PROGRAM.md.
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    REFERRAL_REVERSAL_EVENTS.has((parsed as { type?: string }).type ?? "")
  ) {
    const livemode = (parsed as { livemode?: unknown }).livemode;
    if (
      typeof livemode !== "boolean" ||
      (livemode && !liveSigned) ||
      (!livemode && !testSigned)
    ) {
      return NextResponse.json(
        { error: "Webhook mode mismatch." },
        { status: 401 },
      );
    }
    await referralPaymentReversed(parsed);
    return NextResponse.json({ ok: true, referral: true });
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
  // Keep a record of how each payment went (failed, action required, paid) so
  // the console can show it. Recorded from the verified event before the sync,
  // idempotent by event id, and never allowed to fail the webhook.
  try {
    const payment = billingEventFromWebhook(parsed);
    if (payment) await recordBillingEvent(payment);
  } catch {
    console.error("[stripe] Could not record payment outcome", {
      eventId: event.id,
      type: event.type,
    });
  }
  try {
    const outcome = await synchronizeStripeBilling(event);
    return NextResponse.json({ ok: true, ...outcome, type: event.type });
  } catch {
    // No receipt survives a failed transaction. A non-2xx asks Stripe to retry.
    console.error("[stripe] Billing synchronization failed", {
      eventId: event.id,
      type: event.type,
    });
    await recordSyncFailure(event.type, event.id);
    return NextResponse.json(
      { error: "Billing synchronization unavailable. Retry later." },
      { status: 503 },
    );
  }
}
