import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit-response";
import { z } from "zod";
import { defaultProfileSettings } from "@/product/receptionist/profile";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { runSimulatedPhoneScenario } from "@/product/telephony/live-test";
import { getTelephonyRuntime } from "@/product/telephony/runtime";
import {
  authorizeBusinessMemberOrAdmin,
  loadClientForOrg,
} from "../../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  mode: z.enum(["simulation", "live_instructions"]).default("simulation"),
  scenario: z
    .enum([
      "ai_answers",
      "human_first_missed_then_ai",
      "transfer_request",
      "appointment_request",
    ])
    .default("ai_answers"),
  language: z.enum(["fr", "en"]).default("fr"),
});

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;
  const limited = await enforceRateLimit({
    scope: "call-test",
    subject: `${id}:${access.ctx?.user.id ?? "ops"}`,
    limit: 10,
    windowMs: 10 * 60_000,
  });
  if (limited) return limited;

  const client = await loadClientForOrg(access.organization);
  if (!client) {
    return NextResponse.json(
      { error: "Phone client is not linked." },
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
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const runtime = getReceptionistRuntime();
  const profile = (await runtime.profileStore.getProfile(id)) ?? {
    organizationId: id,
    activated: false,
    settings: defaultProfileSettings(),
    updatedAt: new Date().toISOString(),
  };

  if (parsed.data.mode === "live_instructions") {
    const number =
      profile.settings.phoneSettings?.tradecatchNumberE164 ||
      profile.phoneNumberE164 ||
      access.organization.phoneE164;
    return NextResponse.json({
      ok: true,
      mode: "live_instructions",
      warning:
        "Live mode does not place an outbound call. Call the staging number from an authorized test device. Carrier charges may apply.",
      dialNumber: number ?? null,
      instructions: number
        ? [
            `Call ${number} from your authorized test phone.`,
            "Confirm the webhook URL points at this environment.",
            "Speak with the Receptionist, then open Call History for the record.",
          ]
        : [
            "Assign a TradeCatch / Twilio staging number in Phone Settings first.",
          ],
    });
  }

  const result = await runSimulatedPhoneScenario({
    organizationId: id,
    profile,
    client,
    scenario: parsed.data.scenario,
    language: parsed.data.language,
    events: getTelephonyRuntime().events,
  });

  // Persist simulated session into the tenant call store for history.
  if (result.session) {
    const { created } = await runtime.store.insertSessionIfAbsent(
      result.session,
    );
    if (!created) {
      try {
        await runtime.store.saveSession(result.session);
      } catch {
        /* ignore optimistic conflict on sim */
      }
    }
  }

  return NextResponse.json({ ok: true, mode: "simulation", ...result });
}
