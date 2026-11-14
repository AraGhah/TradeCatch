import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { enforcePolicy } from "@/lib/rate-limit-response";
import { readJsonBody } from "@/lib/request-body";
import {
  completeRecoveryEmailChange,
  MIN_VERIFICATION_NOTES,
  rejectRecoveryRequest,
  VERIFICATION_METHODS,
  verifyRecoveryIdentity,
  type RecoveryActionError,
} from "@/product/saas/auth/account-recovery";
import { authOrigin } from "@/product/saas/auth/route-helpers";

export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "no-store, private" } as const;

const bodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("verify"),
      method: z.enum(VERIFICATION_METHODS),
      notes: z.string().trim().min(MIN_VERIFICATION_NOTES).max(2000),
      /** The administrator ticks that they personally verified the requester. */
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("complete"),
      notes: z.string().trim().max(2000).optional(),
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("reject"),
      notes: z.string().trim().min(5).max(2000),
    })
    .strict(),
]);

const STATUS: Record<RecoveryActionError, number> = {
  not_found: 404,
  wrong_status: 409,
  no_matching_account: 422,
  protected_account: 403,
  weak_evidence: 422,
  email_taken: 409,
  invalid_email: 422,
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status, headers: PRIVATE },
    );
  if (access.via !== "session" || !access.ctx)
    return NextResponse.json(
      { error: "A signed-in administrator is required." },
      { status: 403, headers: PRIVATE },
    );
  const adminUserId = access.ctx.user.id;

  const limited = await enforcePolicy("admin.account-recovery", {
    subject: adminUserId,
  });
  if (limited) return limited;

  const { id } = await params;
  if (!/^rec_[A-Za-z0-9_-]{4,80}$/.test(id))
    return NextResponse.json(
      { error: "Not found." },
      { status: 404, headers: PRIVATE },
    );

  const read = await readJsonBody(request, 8_192);
  if (!read.ok)
    return NextResponse.json(
      { error: read.error },
      { status: read.status, headers: PRIVATE },
    );
  const parsed = bodySchema.safeParse(read.data);
  if (!parsed.success)
    return NextResponse.json(
      {
        error: `Invalid request. Verification needs a method, notes of at least ${MIN_VERIFICATION_NOTES} characters and confirmation.`,
      },
      { status: 400, headers: PRIVATE },
    );

  try {
    const body = parsed.data;
    const result =
      body.action === "verify"
        ? await verifyRecoveryIdentity({
            requestId: id,
            adminUserId,
            method: body.method,
            notes: body.notes,
          })
        : body.action === "complete"
          ? await completeRecoveryEmailChange({
              requestId: id,
              adminUserId,
              notes: body.notes,
              origin: authOrigin(request),
            })
          : await rejectRecoveryRequest({
              requestId: id,
              adminUserId,
              notes: body.notes,
            });
    if (!result.ok)
      return NextResponse.json(
        { error: result.error },
        { status: STATUS[result.error], headers: PRIVATE },
      );
    return NextResponse.json(
      {
        ok: true,
        status: result.request.status,
        ...(result.linkSent === undefined ? {} : { linkSent: result.linkSent }),
      },
      { headers: PRIVATE },
    );
  } catch {
    console.error("[admin/account-recovery] action failed");
    return NextResponse.json(
      { error: "unavailable" },
      { status: 503, headers: PRIVATE },
    );
  }
}
