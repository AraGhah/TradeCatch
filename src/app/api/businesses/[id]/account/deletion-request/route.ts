import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBounded } from "@/lib/request-body";
import { purgeBusinessVoice } from "@/product/receptionist/custom-voice/runtime";
import { getSaasStore } from "@/product/saas/runtime";
import { requireSameBusiness } from "@/product/security/access";
import { recordSecurityEvent } from "@/product/security/hooks";
import { getSupportService } from "@/product/support/runtime";
import { canCloseAccount } from "@/product/support/access";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  /** The business name, typed by the owner to confirm. */
  confirm: z.string().max(200),
});

function normalized(value: string) {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Opens a deletion request for review. Only the owner may ask, and only by
 * typing the business name. Nothing is deleted here: TradeCatch reviews the
 * request, and billing, tax and legal records are kept as required. Asking
 * again while a request is open returns that request.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSameBusiness(id);
  if (!access.ok)
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  if (
    !canCloseAccount(access.ctx.membership.role, access.ctx.isPlatformAdmin)
  ) {
    return NextResponse.json(
      { error: "Only the owner can request deletion." },
      { status: 403 },
    );
  }
  // One string of at most 200 characters; anything bigger is not a confirmation.
  const parsed = bodySchema.safeParse(
    await readJsonBounded(request, 4 * 1024).catch(() => null),
  );
  const organization = await getSaasStore().getOrganization(id);
  if (!organization)
    return NextResponse.json({ error: "Business not found." }, { status: 404 });
  if (
    !parsed.success ||
    normalized(parsed.data.confirm) !== normalized(organization.name)
  ) {
    await recordSecurityEvent({
      organizationId: id,
      actorUserId: access.ctx.user.id,
      action: "account_deletion_confirmation_failed",
    });
    return NextResponse.json(
      {
        error: "Type the business name exactly to confirm.",
        code: "confirmation_mismatch",
      },
      { status: 400 },
    );
  }
  const row = await getSupportService().requestAccountChange(id, "deletion");
  await recordSecurityEvent({
    organizationId: id,
    actorUserId: access.ctx.user.id,
    action: "account_deletion_requested",
    target: row.id,
    detail: "phone routing unchanged until a transition is confirmed",
  });
  // The owner asked for their data to go: remove the cloned voice now rather
  // than wait for the account to be closed. Calls keep working on the standard voice.
  await purgeBusinessVoice(id);
  return NextResponse.json({
    ok: true,
    request: row,
    deleted: false,
    phoneRouting: row.phoneRouting,
  });
}
