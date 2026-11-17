import { decryptSecret, encryptSecret } from "../crypto";
import { CALCOM_API_KEY_PATTERN } from "./client";

/**
 * Cal.com API keys are stored sealed (AES-256-GCM, same scheme as the Google
 * Calendar tokens) under a key derived from AUTH_SECRET *and* a purpose label,
 * so a sealed calendar token can never be opened as a Cal.com credential or
 * the other way round. The plaintext key exists only in memory while a request
 * to Cal.com is being made.
 */
function sealingSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_SECRET is required to protect Cal.com credentials.");
  }
  return `${secret}|calcom-credentials-v1`;
}

export function isValidCalcomApiKey(key: string): boolean {
  return CALCOM_API_KEY_PATTERN.test(key);
}

export function sealCalcomApiKey(apiKey: string): string {
  return encryptSecret(JSON.stringify({ kind: "api_key", apiKey }), sealingSecret());
}

/** The API key, or null when the value is damaged or sealed under another secret. */
export function openCalcomApiKey(ciphertext: string): string | null {
  try {
    const parsed = JSON.parse(decryptSecret(ciphertext, sealingSecret())) as {
      kind?: string;
      apiKey?: string;
    };
    return parsed.kind === "api_key" && parsed.apiKey ? parsed.apiKey : null;
  } catch {
    return null;
  }
}
