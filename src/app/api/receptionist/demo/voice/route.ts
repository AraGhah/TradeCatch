import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/request-body";
import { z } from "zod";
import { getClientIp, rateLimitAsync } from "@/lib/rate-limit";
import {
  demoSpeechText,
  demoVoiceId,
  MAX_DEMO_SPEECH_CHARS,
  type DemoVoiceLocale,
} from "@/lib/demo-voice";

export const dynamic = "force-dynamic";

/**
 * Speaks a receptionist reply with the ElevenLabs voice for that language.
 * The visitor's microphone audio never arrives here: only the reply text.
 * Disable with RECEPTIONIST_DEMO=0. Without ELEVENLABS_API_KEY the browser
 * falls back to its own speech synthesis.
 */

const schema = z.object({
  locale: z.enum(["fr", "en"]),
  text: z.string().trim().min(1).max(MAX_DEMO_SPEECH_CHARS),
});

const CACHE_LIMIT = 32;
const audioCache = new Map<string, ArrayBuffer>();

function remember(key: string, audio: ArrayBuffer) {
  if (audioCache.has(key)) audioCache.delete(key);
  audioCache.set(key, audio);
  if (audioCache.size <= CACHE_LIMIT) return;
  const oldest = audioCache.keys().next().value;
  if (oldest) audioCache.delete(oldest);
}

export async function POST(request: NextRequest) {
  if (process.env.RECEPTIONIST_DEMO === "0") {
    return NextResponse.json({ error: "Demo disabled" }, { status: 404 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "Voice unavailable" }, { status: 503 });
  }

  const { allowed } = await rateLimitAsync({
    key: `demo-voice:${getClientIp(request)}`,
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const read = await readJsonBody(request, 4_096);
  if (!read.ok)
    return NextResponse.json({ error: read.error }, { status: read.status });
  const parsed = schema.safeParse(read.data);
  const text = parsed.success ? demoSpeechText(parsed.data.text) : null;
  if (!parsed.success || !text) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const locale = parsed.data.locale as DemoVoiceLocale;
  const cacheKey = `${locale}:${text}`;
  const cached = audioCache.get(cacheKey);
  if (cached) {
    return new NextResponse(cached.slice(0), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  }

  const voiceId = demoVoiceId(locale);
  let upstream: Response;
  try {
    upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
        }),
        signal: AbortSignal.timeout(12_000),
      },
    );
  } catch (err) {
    console.error("[demo-voice] elevenlabs request failed", err);
    return NextResponse.json({ error: "Voice unavailable" }, { status: 502 });
  }

  if (!upstream.ok) {
    console.error("[demo-voice] elevenlabs status", upstream.status);
    return NextResponse.json({ error: "Voice unavailable" }, { status: 502 });
  }

  const audio = await upstream.arrayBuffer();
  if (audio.byteLength < 64) {
    return NextResponse.json({ error: "Voice unavailable" }, { status: 502 });
  }
  remember(cacheKey, audio);
  return new NextResponse(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
