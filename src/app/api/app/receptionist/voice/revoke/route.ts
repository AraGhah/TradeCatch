import { getVoiceService } from "@/product/receptionist/custom-voice/runtime";
import { forbiddenUnless } from "@/product/security/access";
import {
  limitVoice,
  reply,
  requireVoiceActor,
  voiceErrorResponse,
} from "../_shared";

export const dynamic = "force-dynamic";

/**
 * Withdraws the consent given for the cloned voice. The voice stops being used
 * on the next call, is deleted at the provider, and a new recording needs fresh
 * consent. Allowed on any plan: a business that downgraded can still remove it.
 */
export async function POST() {
  const auth = await requireVoiceActor();
  if (!auth.ok) return auth.response;
  const denied = forbiddenUnless(auth.role, "manage_ai");
  if (denied) return denied;
  const limited = await limitVoice(
    auth.actor,
    "voice-revoke",
    20,
    10 * 60 * 1000,
  );
  if (limited) return limited;
  try {
    const result = await getVoiceService().revokeConsent(auth.actor);
    if (!result.ok) return voiceErrorResponse(result.error);
    return reply({ ok: true, status: result.status });
  } catch (error) {
    console.error(
      "[custom-voice] revoke failed",
      error instanceof Error ? error.name : "error",
    );
    return voiceErrorResponse("provider_error");
  }
}
