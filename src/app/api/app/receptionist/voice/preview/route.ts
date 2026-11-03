import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/lib/request-body";
import { getVoiceService } from "@/product/receptionist/custom-voice/runtime";
import { forbiddenUnless } from "@/product/security/access";
import {
  limitVoice,
  noStore,
  reply,
  requireVoiceActor,
  voiceErrorResponse,
} from "../_shared";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({ locale: z.enum(["en", "fr"]).default("en") })
  .strict();

/**
 * A short, fixed greeting spoken in the cloned voice, so the owner can hear it
 * before it answers a real call. The text is chosen on the server: this cannot
 * be used to synthesize arbitrary speech in the owner's voice.
 */
export async function POST(request: NextRequest) {
  const auth = await requireVoiceActor();
  if (!auth.ok) return auth.response;
  const denied = forbiddenUnless(auth.role, "manage_ai");
  if (denied) return denied;
  const limited = await limitVoice(
    auth.actor,
    "voice-preview",
    20,
    10 * 60 * 1000,
  );
  if (limited) return limited;

  const read = await readJsonBody(request, 1024);
  if (!read.ok) return reply({ error: read.error }, read.status);
  const parsed = bodySchema.safeParse(read.data ?? {});
  if (!parsed.success)
    return reply({ error: "Invalid request.", code: "invalid" }, 400);

  try {
    const result = await getVoiceService().preview(
      auth.actor,
      parsed.data.locale,
    );
    if (!result.ok) return voiceErrorResponse(result.error);
    return new NextResponse(result.audio as BodyInit, {
      status: 200,
      headers: { ...noStore, "Content-Type": result.contentType },
    });
  } catch (error) {
    console.error(
      "[custom-voice] preview failed",
      error instanceof Error ? error.name : "error",
    );
    return voiceErrorResponse("provider_error");
  }
}
