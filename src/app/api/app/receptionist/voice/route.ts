import { NextRequest } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/lib/request-body";
import { getVoiceService } from "@/product/receptionist/custom-voice/runtime";
import { forbiddenUnless } from "@/product/security/access";
import {
  limitVoice,
  reply,
  requireVoiceActor,
  voiceErrorResponse,
} from "./_shared";

export const dynamic = "force-dynamic";

const modeSchema = z.object({ mode: z.enum(["standard", "custom"]) }).strict();

/** Where the business's receptionist voice stands. Never includes the voice id. */
export async function GET() {
  const auth = await requireVoiceActor();
  if (!auth.ok) return auth.response;
  try {
    return reply({
      ok: true,
      status: await getVoiceService().status(auth.actor),
    });
  } catch (error) {
    console.error("[custom-voice] status failed", error);
    return reply(
      { error: "Voice settings are unavailable.", code: "unavailable" },
      503,
    );
  }
}

/**
 * Choose which voice calls use. `standard` is always allowed. `custom` needs
 * Receptionist Plus, a cloned voice with consent on record, and a preview.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireVoiceActor();
  if (!auth.ok) return auth.response;
  const denied = forbiddenUnless(auth.role, "manage_ai");
  if (denied) return denied;
  const limited = await limitVoice(
    auth.actor,
    "voice-mode",
    30,
    10 * 60 * 1000,
  );
  if (limited) return limited;

  const read = await readJsonBody(request, 1024);
  if (!read.ok) return reply({ error: read.error }, read.status);
  const parsed = modeSchema.safeParse(read.data);
  if (!parsed.success)
    return reply({ error: "Invalid request.", code: "invalid" }, 400);

  try {
    const result = await getVoiceService().setMode(
      auth.actor,
      parsed.data.mode,
    );
    if (!result.ok) return voiceErrorResponse(result.error);
    return reply({ ok: true, status: result.status });
  } catch (error) {
    console.error("[custom-voice] set mode failed", error);
    return voiceErrorResponse("provider_error");
  }
}

/** Delete the cloned voice (here and at the provider) and go back to the standard voice. */
export async function DELETE() {
  const auth = await requireVoiceActor();
  if (!auth.ok) return auth.response;
  const denied = forbiddenUnless(auth.role, "manage_ai");
  if (denied) return denied;
  const limited = await limitVoice(
    auth.actor,
    "voice-delete",
    20,
    10 * 60 * 1000,
  );
  if (limited) return limited;
  try {
    const result = await getVoiceService().deleteVoice(auth.actor);
    if (!result.ok) return voiceErrorResponse(result.error);
    return reply({ ok: true, status: result.status });
  } catch (error) {
    console.error("[custom-voice] delete failed", error);
    return voiceErrorResponse("provider_error");
  }
}
