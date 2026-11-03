/**
 * Minimal ElevenLabs client for voice cloning: create a voice from a sample,
 * delete it, synthesize a preview and transcribe a sample (to check the spoken
 * verification phrase).
 *
 * Plain `fetch` on purpose: the app also runs on Cloudflare Workers, where the
 * Node SDK is not available. The API key stays on the server and is never put
 * in a URL, a log line or an error message. Every call has a timeout, and every
 * failure is reduced to a small `ProviderError` so nothing the provider says
 * (which can echo request details) reaches a customer.
 */

import { DEFAULT_TTS_MODEL, type TtsModel } from "./model";

const DEFAULT_BASE_URL = "https://api.elevenlabs.io";

export type ProviderFailure =
  | "unauthorized"
  | "quota"
  | "invalid_sample"
  | "not_found"
  | "rate_limited"
  | "unavailable"
  | "bad_response";

export class ProviderError extends Error {
  constructor(
    public readonly failure: ProviderFailure,
    public readonly status?: number,
  ) {
    super(`ElevenLabs request failed: ${failure}${status ? ` (${status})` : ""}`);
    this.name = "ProviderError";
  }
}

export type SampleFile = { bytes: Uint8Array; filename: string; mime: string };

export type VoiceProvider = {
  createVoice(input: {
    name: string;
    description: string;
    labels: Record<string, string>;
    sample: SampleFile;
  }): Promise<{ voiceId: string }>;
  /** Idempotent: a voice that is already gone counts as deleted. */
  deleteVoice(voiceId: string): Promise<void>;
  synthesize(input: {
    voiceId: string;
    text: string;
    model?: TtsModel;
  }): Promise<{ audio: Uint8Array; contentType: string }>;
  transcribe(sample: SampleFile): Promise<{ text: string }>;
};

export type ElevenLabsOptions = {
  apiKey: string;
  baseUrl?: string;
  sttModel?: string;
  fetchImpl?: typeof fetch;
  /** Cloning and transcription upload audio and are slower than a preview. */
  timeoutMs?: number;
};

/** The configured key, or null when this deployment has no provider. */
export function elevenLabsKeyFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const key = env.ELEVENLABS_API_KEY?.trim();
  return key ? key : null;
}

function failureFor(status: number): ProviderFailure {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 402) return "quota";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 413 || status === 415 || status === 422) {
    return "invalid_sample";
  }
  return "unavailable";
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export function createElevenLabsClient(options: ElevenLabsOptions): VoiceProvider {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const sttModel = options.sttModel?.trim() || "scribe_v2";

  async function call(
    path: string,
    init: Omit<RequestInit, "signal" | "headers"> & { headers?: Record<string, string> },
  ): Promise<Response> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        ...init,
        headers: { "xi-api-key": options.apiKey, ...init.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Network failure or timeout. Nothing from the error is kept: it can
      // contain the request URL.
      throw new ProviderError("unavailable");
    }
    if (!response.ok) {
      // Drain the body without reading it into an error message.
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderError(failureFor(response.status), response.status);
    }
    return response;
  }

  function sampleForm(sample: SampleFile, field: string, form: FormData) {
    form.append(
      field,
      new Blob([toArrayBuffer(sample.bytes)], { type: sample.mime }),
      sample.filename,
    );
  }

  return {
    async createVoice({ name, description, labels, sample }) {
      const form = new FormData();
      form.append("name", name);
      form.append("description", description);
      form.append("labels", JSON.stringify(labels));
      sampleForm(sample, "files", form);
      const response = await call("/v1/voices/add", { method: "POST", body: form });
      const data = (await response.json().catch(() => null)) as {
        voice_id?: unknown;
      } | null;
      if (typeof data?.voice_id !== "string" || !data.voice_id) {
        throw new ProviderError("bad_response", response.status);
      }
      return { voiceId: data.voice_id };
    },

    async deleteVoice(voiceId) {
      try {
        await call(`/v1/voices/${encodeURIComponent(voiceId)}`, { method: "DELETE" });
      } catch (error) {
        // Already gone is the outcome we wanted.
        if (error instanceof ProviderError && error.failure === "not_found") return;
        throw error;
      }
    },

    async synthesize({ voiceId, text, model = DEFAULT_TTS_MODEL }) {
      const response = await call(
        `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_64`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({ text, model_id: model }),
        },
      );
      const audio = new Uint8Array(await response.arrayBuffer());
      if (audio.byteLength === 0) throw new ProviderError("bad_response", response.status);
      return { audio, contentType: "audio/mpeg" };
    },

    async transcribe(sample) {
      const form = new FormData();
      form.append("model_id", sttModel);
      sampleForm(sample, "file", form);
      const response = await call("/v1/speech-to-text", { method: "POST", body: form });
      const data = (await response.json().catch(() => null)) as {
        text?: unknown;
      } | null;
      if (typeof data?.text !== "string") {
        throw new ProviderError("bad_response", response.status);
      }
      return { text: data.text };
    },
  };
}
