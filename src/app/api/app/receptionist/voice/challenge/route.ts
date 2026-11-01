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
} from "../_shared";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({ locale: z.enum(["en", "fr"]).default("en") })
  .strict();

/**
 * Starts a recording: three random words the owner will say aloud, signed for
 * this business and user, valid for ten minutes. The words are chosen here, so
 * a clip recorded earlier cannot contain them.
 */
export async function POST(request: NextRequest) {
  const auth = await requireVoiceActor();
  if (!auth.ok) return auth.response;
  const denied = forbiddenUnless(auth.role, "manage_ai");
  if (denied) return denied;
  const limited = await limitVoice(
    auth.actor,
    "voice-challenge",
    10,
    60 * 60 * 1000,
  );
  if (limited) return limited;

  const read = await readJsonBody(request, 1024);
  if (!read.ok) return reply({ error: read.error }, read.status);
  const parsed = bodySchema.safeParse(read.data ?? {});
  if (!parsed.success)
    return reply({ error: "Invalid request.", code: "invalid" }, 400);

  try {
    const result = await getVoiceService().challenge(
      auth.actor,
      parsed.data.locale,
    );
    if (!result.ok) return voiceErrorResponse(result.error);
    return reply({
      ok: true,
      challenge: result.challenge,
      consentVersion: result.consentVersion,
    });
  } catch (error) {
    console.error("[custom-voice] challenge failed", error);
    return voiceErrorResponse("provider_error");
  }
}
