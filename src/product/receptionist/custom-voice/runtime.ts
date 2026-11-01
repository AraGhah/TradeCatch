import {
  isDurableMissedCallStoreConfigured,
  isProductionRuntime,
} from "@/lib/config";
import { getAuthSecret } from "@/product/saas/auth/secret";
import { createElevenLabsClient, elevenLabsKeyFromEnv } from "./elevenlabs";
import { createPostgresVoiceStore } from "./postgres-store";
import { createVoiceService, type VoiceService } from "./service";
import { createMemoryVoiceStore, type OrgVoiceStore } from "./store";

const globalForVoice = globalThis as unknown as {
  __tradecatchCustomVoice?: VoiceService;
};

function createStore(): OrgVoiceStore {
  const url = process.env.DATABASE_URL?.trim();
  const wantDurable =
    isDurableMissedCallStoreConfigured() || process.env.SAAS_DURABLE_STORE === "1";

  if (wantDurable && url) return createPostgresVoiceStore(url);
  if (wantDurable && !url) {
    throw new Error("[custom-voice] Durable store requires DATABASE_URL");
  }
  if (isProductionRuntime() && process.env.SAAS_REQUIRE_DURABLE === "1") {
    throw new Error("[custom-voice] Refusing memory store when SAAS_REQUIRE_DURABLE=1");
  }
  return createMemoryVoiceStore();
}

function create(): VoiceService {
  const key = elevenLabsKeyFromEnv();
  const authSecret = getAuthSecret();
  return createVoiceService({
    store: createStore(),
    // No auth secret means the challenge could not be signed safely: the
    // feature reports itself unavailable rather than using a guessable secret.
    provider:
      key && authSecret
        ? createElevenLabsClient({
            apiKey: key,
            sttModel: process.env.ELEVENLABS_STT_MODEL,
          })
        : null,
    // Derived, not the raw session secret: a leaked challenge signature must
    // never help forge anything else that is signed with AUTH_SECRET.
    challengeSecret: `${authSecret ?? ""}|custom-voice-challenge|v1`,
  });
}

/**
 * One service per process. Without ELEVENLABS_API_KEY the provider is null and
 * the feature reports itself unavailable; calls keep using the standard voice.
 * Without an auth secret nothing can be signed, so cloning is also unavailable.
 */
export function getVoiceService(): VoiceService {
  if (!globalForVoice.__tradecatchCustomVoice) {
    globalForVoice.__tradecatchCustomVoice = create();
  }
  return globalForVoice.__tradecatchCustomVoice;
}

export function resetVoiceServiceForTests() {
  delete globalForVoice.__tradecatchCustomVoice;
}

/**
 * Removes a business's cloned voice (at the provider and here) when the
 * business asks to be deleted or is deleted. Best effort: it never throws, so
 * it cannot block or fail the deletion itself, and a provider that is down
 * simply leaves the voice for the next attempt. Returns whether it is gone.
 */
export async function purgeBusinessVoice(organizationId: string): Promise<boolean> {
  try {
    return await getVoiceService().purgeOrganization(organizationId);
  } catch (error) {
    console.error("[custom-voice] purge failed", error instanceof Error ? error.name : "error");
    return false;
  }
}
