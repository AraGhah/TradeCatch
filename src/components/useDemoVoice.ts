"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Browser-only voice for the website demo: the visitor speaks (Web Speech
 * recognition) and hears the receptionist (speech synthesis). TradeCatch never
 * receives audio: the browser, or its speech provider, turns the voice into
 * text and only that text is sent to the demo endpoint.
 */

type RecognitionResultLike = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEventLike = { results: ArrayLike<RecognitionResultLike> };
type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => RecognitionLike;

export type VoiceFailure = "denied" | "no_speech" | "unavailable";

/** How long one listening turn may last before it is closed. */
const MAX_LISTEN_MS = 15_000;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function synthesis(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

function subscribe() {
  return () => {};
}

/** Best installed voice for the language: exact region, then same language. */
function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: string,
): SpeechSynthesisVoice | null {
  const norm = (value: string) => value.toLowerCase().replace("_", "-");
  const wanted = norm(lang);
  const primary = wanted.split("-")[0]!;
  return (
    voices.find((v) => norm(v.lang) === wanted) ??
    voices.find((v) => norm(v.lang).split("-")[0] === primary) ??
    null
  );
}

function failureFor(error: string): VoiceFailure {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "denied";
  }
  if (error === "no-speech") return "no_speech";
  return "unavailable";
}

export function useDemoVoice(locale: "fr" | "en") {
  const lang = locale === "fr" ? "fr-CA" : "en-CA";
  /** True once hydrated, so "not supported" is never flashed during SSR. */
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const canListen = useSyncExternalStore(
    subscribe,
    () => recognitionCtor() !== null,
    () => false,
  );
  const canSpeak = useSyncExternalStore(
    subscribe,
    () => synthesis() !== null,
    () => false,
  );

  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");

  const recognition = useRef<RecognitionLike | null>(null);
  const listenTimer = useRef<number | null>(null);
  const speechRun = useRef(0);
  // Chrome drops utterances that are garbage-collected before they finish.
  const utterances = useRef<SpeechSynthesisUtterance[]>([]);

  const stopListening = useCallback(() => {
    if (listenTimer.current !== null) {
      window.clearTimeout(listenTimer.current);
      listenTimer.current = null;
    }
    const rec = recognition.current;
    recognition.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        // Already stopped.
      }
    }
    setListening(false);
    setInterim("");
  }, []);

  const cancelSpeech = useCallback(() => {
    speechRun.current += 1;
    utterances.current = [];
    synthesis()?.cancel();
    setSpeaking(false);
  }, []);

  const listen = useCallback(
    (handlers: {
      onFinal: (text: string) => void;
      onFail: (reason: VoiceFailure) => void;
    }) => {
      const Ctor = recognitionCtor();
      if (!Ctor) {
        handlers.onFail("unavailable");
        return;
      }
      cancelSpeech();
      stopListening();

      const rec = new Ctor();
      rec.lang = lang;
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      let heard = "";
      let settled = false;
      const settle = (run: () => void) => {
        if (settled) return;
        settled = true;
        if (recognition.current === rec) stopListening();
        run();
      };

      rec.onresult = (event) => {
        const results = Array.from(event.results);
        heard = results
          .map((r) => r[0].transcript)
          .join(" ")
          .trim();
        const last = results.at(-1);
        if (last?.isFinal && heard) {
          settle(() => handlers.onFinal(heard));
        } else {
          setInterim(heard);
        }
      };
      rec.onerror = (event) => {
        settle(() => handlers.onFail(failureFor(event.error)));
      };
      rec.onend = () => {
        // Some browsers close after an interim result without a final one.
        settle(() =>
          heard ? handlers.onFinal(heard) : handlers.onFail("no_speech"),
        );
      };

      recognition.current = rec;
      listenTimer.current = window.setTimeout(() => {
        try {
          rec.stop();
        } catch {
          // Already stopped.
        }
      }, MAX_LISTEN_MS);
      try {
        rec.start();
        setListening(true);
        setInterim("");
      } catch {
        settle(() => handlers.onFail("unavailable"));
      }
    },
    [lang, cancelSpeech, stopListening],
  );

  /**
   * Speaks the lines in order, then calls `onDone` once (also when speech is
   * unavailable, fails, or is cancelled by the next call to `speak`).
   */
  const speak = useCallback(
    (lines: string[], onDone: () => void) => {
      const synth = synthesis();
      const clean = lines.map((l) => l.trim()).filter(Boolean);
      if (!synth || clean.length === 0) {
        onDone();
        return;
      }
      cancelSpeech();
      const run = speechRun.current;
      const voice = pickVoice(synth.getVoices(), lang);

      let finished = false;
      const timers: number[] = [];
      const finish = () => {
        if (finished) return;
        finished = true;
        timers.forEach((id) => window.clearTimeout(id));
        if (speechRun.current !== run) return;
        utterances.current = [];
        setSpeaking(false);
        onDone();
      };

      const queue = clean.map((text, i) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        if (voice) utterance.voice = voice;
        utterance.rate = 1;
        if (i === clean.length - 1) {
          utterance.onend = finish;
          utterance.onerror = finish;
        }
        return utterance;
      });
      utterances.current = queue;
      const characters = clean.join(" ").length;
      // Some browsers never fire `end`; do not leave the call waiting forever.
      timers.push(window.setTimeout(finish, characters * 110 + 6_000));
      setSpeaking(true);
      queue.forEach((utterance) => synth.speak(utterance));
    },
    [lang, cancelSpeech],
  );

  /** Mobile Safari only allows speech that starts inside a user gesture. */
  const prime = useCallback(() => {
    const synth = synthesis();
    if (!synth) return;
    const utterance = new SpeechSynthesisUtterance(" ");
    utterance.volume = 0;
    synth.speak(utterance);
  }, []);

  useEffect(() => {
    // Chrome loads its voice list lazily; touching it early avoids an empty list.
    synthesis()?.getVoices();
    return () => {
      stopListening();
      cancelSpeech();
    };
  }, [stopListening, cancelSpeech]);

  return {
    ready,
    canListen,
    canSpeak,
    listening,
    speaking,
    interim,
    listen,
    stopListening,
    speak,
    cancelSpeech,
    prime,
  };
}
