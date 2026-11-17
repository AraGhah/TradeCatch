import { NextRequest } from "next/server";
import { handleBlandWebhook } from "@/product/bland/webhook";

export const dynamic = "force-dynamic";

/**
 * Bland's signed post-call webhook (X-Webhook-Signature, HMAC-SHA256 of the
 * raw body with BLAND_WEBHOOK_SECRET). Finalizes the call into the normal
 * receptionist record, owner summary, CRM sync and notifications.
 */
export async function POST(request: NextRequest) {
  return handleBlandWebhook(request);
}
