import { NextRequest } from "next/server";
import { z } from "zod";
import { BodyTooLargeError, readMultipartBounded } from "@/lib/request-body";
import { MAX_SAMPLE_BYTES } from "@/product/receptionist/custom-voice/model";
import { getVoiceService } from "@/product/receptionist/custom-voice/runtime";
import { forbiddenUnless } from "@/product/security/access";
import {
  limitVoice,
  reply,
  requireVoiceActor,
  voiceErrorResponse,
} from "../_shared";

export const dynamic = "force-dynamic";

// The sample plus a little multipart framing and the small text fields.
const MAX_BODY_BYTES = MAX_SAMPLE_BYTES + 1024 * 1024;

const fieldsSchema = z.object({
  consentAccepted: z.literal("true"),
  consentVersion: z.string().min(1).max(40),
  signerName: z.string().min(1).max(200),
  challengeToken: z.string().min(1).max(512),
});

/**
 * Creates the cloned voice from a recording the owner made (in the browser or
 * uploaded). multipart/form-data: `consentAccepted`, `consentVersion`,
 * `signerName`, `challengeToken` and the audio as `sample`.
 *
 * The audio is read into memory, checked, sent to the provider and dropped. It
 * is never written to disk, a database or storage, and never logged.
 */
export async function POST(request: NextRequest) {
  const auth = await requireVoiceActor();
  if (!auth.ok) return auth.response;
  const denied = forbiddenUnless(auth.role, "manage_ai");
  if (denied) return denied;
  const limited = await limitVoice(
    auth.actor,
    "voice-clone",
    6,
    60 * 60 * 1000,
  );
  if (limited) return limited;

  let form: FormData | null;
  try {
    form = await readMultipartBounded(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return reply(
        { error: "Payload too large.", code: "sample_invalid" },
        413,
      );
    }
    return reply({ error: "Invalid upload.", code: "invalid" }, 400);
  }
  if (!form) return reply({ error: "Invalid upload.", code: "invalid" }, 400);

  const fields = fieldsSchema.safeParse({
    consentAccepted: form.get("consentAccepted"),
    consentVersion: form.get("consentVersion"),
    signerName: form.get("signerName"),
    challengeToken: form.get("challengeToken"),
  });
  const file = form.get("sample");
  if (!fields.success) {
    // The only field a person can leave out is the consent box.
    return voiceErrorResponse("consent_required");
  }
  if (!(file instanceof Blob)) return voiceErrorResponse("sample_invalid");

  try {
    const result = await getVoiceService().createClone(auth.actor, {
      consent: {
        accepted: true,
        statementVersion: fields.data.consentVersion,
        signerName: fields.data.signerName,
      },
      challengeToken: fields.data.challengeToken,
      sample: new Uint8Array(await file.arrayBuffer()),
    });
    if (!result.ok) return voiceErrorResponse(result.error);
    return reply({ ok: true, status: result.status }, 201);
  } catch (error) {
    console.error(
      "[custom-voice] clone failed",
      error instanceof Error ? error.name : "error",
    );
    return voiceErrorResponse("provider_error");
  }
}
