"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

const MAX_SECONDS = 180;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Safari records MP4/AAC, other browsers WebM/Opus: take what the browser can do. */
function pickRecorderType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

function extensionFor(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  return "webm";
}

type RecorderError = "denied" | "noDevice" | "unsupported" | "failed" | "tooLarge" | "notAudio";

/**
 * Records from the microphone, or takes an uploaded audio file, and hands the
 * result to the parent as a File. The audio stays in the browser until the
 * owner presses "Create my voice"; nothing is uploaded while recording.
 */
export function VoiceRecorder({
  disabled,
  onSample,
}: {
  disabled: boolean;
  onSample: (file: File | null) => void;
}) {
  const t = useTranslations("app.voice.record");
  const [phase, setPhase] = useState<"idle" | "recording" | "recorded">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<RecorderError | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [source, setSource] = useState<"recorded" | "uploaded" | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const urlRef = useRef<string | null>(null);

  const releaseMic = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  const setPreview = useCallback((file: File | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = file ? URL.createObjectURL(file) : null;
    setUrl(urlRef.current);
  }, []);

  // Never leave the microphone on, or a blob URL alive, after leaving the page.
  useEffect(
    () => () => {
      releaseMic();
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [releaseMic],
  );

  const stop = useCallback(() => {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }, []);

  async function start() {
    setError(null);
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("unsupported");
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      stream.current = media;
      const type = pickRecorderType();
      const rec = new MediaRecorder(media, type ? { mimeType: type } : undefined);
      recorder.current = rec;
      chunks.current = [];
      rec.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      rec.onstop = () => {
        releaseMic();
        const mime = rec.mimeType || type || "audio/webm";
        const file = new File(chunks.current, `sample.${extensionFor(mime)}`, { type: mime });
        if (file.size > MAX_UPLOAD_BYTES) {
          setError("tooLarge");
          setPhase("idle");
          onSample(null);
          return;
        }
        setPreview(file);
        setSource("recorded");
        setPhase("recorded");
        onSample(file);
      };
      rec.start(1000);
      const startedAt = Date.now();
      setSeconds(0);
      setPhase("recording");
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_SECONDS) stop();
      }, 500);
    } catch (err) {
      releaseMic();
      const name = err instanceof DOMException ? err.name : "";
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "denied"
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "noDevice"
            : "failed",
      );
    }
  }

  function retake() {
    setPreview(null);
    setSource(null);
    setPhase("idle");
    setSeconds(0);
    onSample(null);
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("audio/")) {
      setError("notAudio");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("tooLarge");
      return;
    }
    setPreview(file);
    setSource("uploaded");
    setPhase("recorded");
    onSample(file);
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const button =
    "rounded-md px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex flex-col gap-3">
      {phase === "idle" ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={start}
            disabled={disabled}
            className={`${button} bg-navy text-white`}
          >
            {t("start")}
          </button>
          <span className="text-sm text-navy/60">{t("or")}</span>
          <label className="text-sm text-navy">
            <span className="sr-only">{t("uploadLabel")}</span>
            <input
              type="file"
              accept="audio/*"
              disabled={disabled}
              onChange={onFile}
              className="block max-w-full text-sm text-navy file:mr-3 file:rounded-md file:border file:border-navy/20 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-navy"
            />
          </label>
        </div>
      ) : null}

      {phase === "recording" ? (
        <div className="flex flex-wrap items-center gap-3" role="status">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-navy">
            <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
            {t("recording")} {mm}:{ss}
          </span>
          <button type="button" onClick={stop} className={`${button} bg-navy text-white`}>
            {t("stop")}
          </button>
        </div>
      ) : null}

      {phase === "recorded" && url ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-navy">
            {source === "uploaded" ? t("uploaded") : t("recorded")}
          </p>
          <audio controls src={url} className="w-full max-w-md" />
          <button
            type="button"
            onClick={retake}
            disabled={disabled}
            className={`${button} w-fit border border-navy/20 bg-white text-navy`}
          >
            {t("retake")}
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {t(`errors.${error}`)}
        </p>
      ) : null}
    </div>
  );
}
