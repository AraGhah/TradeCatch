import { MAX_SAMPLE_BYTES, MIN_SAMPLE_BYTES } from "./model";

/** Container formats browsers record and phones export. */
export type SampleKind = "webm" | "ogg" | "wav" | "mp3" | "m4a" | "flac";

const MIME_BY_KIND: Record<SampleKind, string> = {
  webm: "audio/webm",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  flac: "audio/flac",
};

const FILENAME_BY_KIND: Record<SampleKind, string> = {
  webm: "sample.webm",
  ogg: "sample.ogg",
  wav: "sample.wav",
  mp3: "sample.mp3",
  m4a: "sample.m4a",
  flac: "sample.flac",
};

/**
 * Identifies an audio file by what it IS, not by the name or content type the
 * client claimed. Anything that is not a recognised audio container is refused,
 * so this endpoint cannot be used to push arbitrary files at the provider.
 */
export function sniffSample(bytes: Uint8Array): SampleKind | null {
  if (bytes.length < 12) return null;
  const at = (i: number) => bytes[i]!;
  const ascii = (start: number, text: string) =>
    [...text].every((c, i) => at(start + i) === c.charCodeAt(0));

  if (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) return "webm";
  if (ascii(0, "OggS")) return "ogg";
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "wav";
  if (ascii(0, "fLaC")) return "flac";
  if (ascii(4, "ftyp")) return "m4a";
  if (ascii(0, "ID3")) return "mp3";
  // MPEG audio frame sync (also covers ADTS AAC): 11 set bits.
  if (at(0) === 0xff && (at(1) & 0xe0) === 0xe0) return "mp3";
  return null;
}

export type SampleCheck =
  | { ok: true; kind: SampleKind; mime: string; filename: string }
  | { ok: false; reason: "too_small" | "too_large" | "not_audio" };

export function checkSample(bytes: Uint8Array): SampleCheck {
  if (bytes.length > MAX_SAMPLE_BYTES) return { ok: false, reason: "too_large" };
  if (bytes.length < MIN_SAMPLE_BYTES) return { ok: false, reason: "too_small" };
  const kind = sniffSample(bytes);
  if (!kind) return { ok: false, reason: "not_audio" };
  return { ok: true, kind, mime: MIME_BY_KIND[kind], filename: FILENAME_BY_KIND[kind] };
}
