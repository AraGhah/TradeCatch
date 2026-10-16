import { NextRequest, NextResponse } from "next/server";
import {
  BusinessTestError,
  runBusinessTestTurn,
} from "@/product/receptionist/business-test";
import { defaultProfileSettings } from "@/product/receptionist/profile";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { getAuthSecret } from "@/product/saas/tenant";
import {
  authorizeBusinessMemberOrAdmin,
  loadClientForOrg,
} from "../../_shared";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    language: z.enum(["fr", "en"]).default("fr"),
    scenario: z.enum(["open", "after_hours"]).default("open"),
  }),
  z.object({
    action: z.literal("say"),
    state: z.string().min(1),
    speech: z.string().min(1).max(400),
  }),
]);

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const client = await loadClientForOrg(access.organization);
  if (!client) {
    return NextResponse.json(
      { error: "Phone client is not linked for this business." },
      { status: 409 },
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

  const secret =
    getAuthSecret() ||
    (process.env.NODE_ENV === "production"
      ? null
      : "dev-only-receptionist-biz-test-secret");
  if (!secret) {
    return NextResponse.json(
      { error: "Auth secret is not configured." },
      { status: 503 },
    );
  }

  const runtime = getReceptionistRuntime();
  const existing = await runtime.profileStore.getProfile(id);
  const profile = existing ?? {
    organizationId: id,
    activated: false,
    settings: defaultProfileSettings(),
    updatedAt: new Date().toISOString(),
  };

  try {
    const result = await runBusinessTestTurn(parsed.data, {
      organizationId: id,
      profile,
      client,
      secret,
      persistSession: async (session) => {
        // Simulated only — never triggers SMS/email. Persist for history/isolation checks.
        const { created } = await runtime.store.insertSessionIfAbsent(session);
        if (!created) {
          try {
            await runtime.store.saveSession(session);
          } catch {
            // Optimistic conflict on sim sessions is non-fatal for the UI.
          }
        }
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof BusinessTestError) {
      const status =
        err.code === "expired" || err.code === "invalid_state" ? 400 : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    throw err;
  }
}
