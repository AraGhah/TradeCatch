import { readJsonBody } from "@/lib/request-body";
import { NextRequest, NextResponse } from "next/server";
import { forbiddenUnless, requireSameBusiness } from "@/product/security/access";
import { loadPrivacySettings, savePrivacySettings } from "@/product/privacy/runtime";
import { patchFrom, privacyPatchSchema } from "@/product/privacy/settings";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_PATCH_BYTES = 4 * 1024;

/** The business's stored privacy settings (defaults when never saved). Any member may read them. */
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSameBusiness(id);
  if (!access.ok)
    return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    return NextResponse.json(
      { ok: true, settings: await loadPrivacySettings(id) },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error(
      "[privacy] settings load failed",
      error instanceof Error ? error.name : "error",
    );
    return NextResponse.json(
      { error: "Unable to load privacy settings." },
      { status: 503, headers: NO_STORE },
    );
  }
}

/**
 * Saves only the settings named in the body, and only if `expectedVersion`
 * still matches what is stored (409 with the current values otherwise). The
 * response carries the values as stored, so the page shows what was saved,
 * never what it asked for.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await requireSameBusiness(id);
  if (!access.ok)
    return NextResponse.json({ error: access.error }, { status: access.status });
  const denied = forbiddenUnless(
    access.ctx.membership.role,
    "manage_security",
    access.ctx.isPlatformAdmin,
  );
  if (denied) return denied;

  // A save names at most six small fields; anything larger is not a save.
  const body = await readJsonBody(request, MAX_PATCH_BYTES);
  if (!body.ok)
    return NextResponse.json(
      { error: body.error },
      { status: body.status, headers: NO_STORE },
    );
  const parsed = privacyPatchSchema.safeParse(body.data);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid privacy settings." },
      { status: 400, headers: NO_STORE },
    );

  try {
    const result = await savePrivacySettings({
      organizationId: id,
      actorUserId: access.ctx.user.id,
      expectedVersion: parsed.data.expectedVersion,
      patch: patchFrom(parsed.data),
    });
    if (!result.ok)
      return NextResponse.json(
        {
          error: "These settings were changed elsewhere. Review the current values and save again.",
          code: "stale",
          settings: result.current,
        },
        { status: 409, headers: NO_STORE },
      );
    return NextResponse.json(
      { ok: true, settings: result.settings },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error(
      "[privacy] settings save failed",
      error instanceof Error ? error.name : "error",
    );
    return NextResponse.json(
      { error: "Unable to save privacy settings." },
      { status: 503, headers: NO_STORE },
    );
  }
}
