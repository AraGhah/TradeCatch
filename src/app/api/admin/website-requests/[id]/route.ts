import { NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { readJsonBody } from "@/lib/request-body";
import { websiteRequestUpdateSchema } from "@/lib/validation/website-request";
import type { WebsiteRequestUpdateError } from "@/product/website-services/service";
import { getWebsiteRequestService } from "@/product/website-services/runtime";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers });

const STATUS_FOR_ERROR: Record<WebsiteRequestUpdateError, number> = {
  not_found: 404,
  invalid_transition: 409,
  locked: 409,
  conflict: 409,
  price_too_low: 400,
  quote_required: 400,
};

const MESSAGE_FOR_ERROR: Record<WebsiteRequestUpdateError, string> = {
  not_found: "Request not found.",
  invalid_transition:
    "That status change is not allowed from the current status.",
  locked: "The agreed scope and price cannot be changed once work has started.",
  conflict:
    "The request changed while you were editing it. Reload and try again.",
  price_too_low: "The price cannot be below the starting price.",
  quote_required:
    "Add the written scope and the final price before quoting or starting work.",
};

type Params = { params: Promise<{ id: string }> };

/**
 * Move a request through review, quote, work and delivery, and record the
 * scope and final price the customer will confirm. Administrators only; the
 * request is never charged from here.
 */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return reply({ error: auth.error }, auth.status);

  const { id } = await params;
  if (!/^wsr_[A-Za-z0-9-]{8,64}$/.test(id)) {
    return reply({ error: MESSAGE_FOR_ERROR.not_found }, 404);
  }
  const read = await readJsonBody(request, 8192);
  if (!read.ok) return reply({ error: read.error }, read.status);
  const parsed = websiteRequestUpdateSchema.safeParse(read.data);
  if (!parsed.success) return reply({ error: "Invalid update." }, 400);

  try {
    const result = await getWebsiteRequestService().adminUpdate(
      id,
      parsed.data,
    );
    if (!result.ok) {
      return reply(
        { error: MESSAGE_FOR_ERROR[result.error], code: result.error },
        STATUS_FOR_ERROR[result.error],
      );
    }
    return reply({ ok: true, request: result.request });
  } catch (error) {
    console.error("[website-requests] admin update failed", error);
    return reply({ error: "Website requests are unavailable." }, 503);
  }
}
