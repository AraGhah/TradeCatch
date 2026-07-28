"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  NARRATION,
  scenesFor,
  sfxMarks,
  totalDurationSec,
  type DemoLocale,
  type SceneId,
} from "./timeline";

/**
 * Demo audio: neural MP3 narration (en/fr) + Web Audio SFX.
 */
export function useDemoAudio(enabled: boolean, locale: DemoLocale) {
  const ctxRef = useRef<AudioContext | null>(null);
  const musicGainRef = useRef<GainNode | null>(null);
  const musicNodesRef = useRef<OscillatorNode[]>([]);
  const lastSceneRef = useRef<SceneId | null>(null);
  const lastSfxRef = useRef<Set<string>>(new Set());
  const voiceEnabledRef = useRef(true);
  const narrationRef = useRef<HTMLAudioElement | null>(null);
  const narrationCache = useRef<Map<string, HTMLAudioElement>>(new Map());
  const mp3Available = useRef<Map<string, boolean>>(new Map());
  const localeRef = useRef(locale);
  localeRef.current = locale;

  const ensureCtx = useCallback(async () => {
    if (typeof window === "undefined") return null;
    try {
      if (!ctxRef.current) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        ctxRef.current = new Ctx();
      }
      if (ctxRef.current.state === "suspended") {
        await ctxRef.current.resume();
      }
      return ctxRef.current;
    } catch {
      return null;
    }
  }, []);

  const stopMusic = useCallback(() => {
    musicNodesRef.current.forEach((n) => {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    });
    musicNodesRef.current = [];
  }, []);

  const startMusic = useCallback(async () => {
    if (!enabled) return;
    const ctx = await ensureCtx();
    if (!ctx || musicNodesRef.current.length) return;

    const master = ctx.createGain();
    master.gain.value = 0.028;
    master.connect(ctx.destination);
    musicGainRef.current = master;

    [110, 164.81, 196].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = i === 0 ? "triangle" : "sine";
      osc.frequency.value = freq;
      g.gain.value = 0.22 / (i + 1);
      osc.connect(g);
      g.connect(master);
      osc.start();
      musicNodesRef.current.push(osc);
    });
  }, [enabled, ensureCtx]);

  const setMusicLevel = useCallback((level: number) => {
    if (musicGainRef.current) {
      try {
        musicGainRef.current.gain.setTargetAtTime(
          level,
          musicGainRef.current.context.currentTime,
          0.2,
        );
      } catch {
        /* ignore */
      }
    }
  }, []);

  const beep = useCallback(
    async (
      freq: number,
      duration: number,
      type: OscillatorType = "sine",
      gain = 0.08,
    ) => {
      if (!enabled) return;
      const ctx = await ensureCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.value = gain;
      osc.connect(g);
      g.connect(ctx.destination);
      const now = ctx.currentTime;
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    },
    [enabled, ensureCtx],
  );

  const playRing = useCallback(async () => {
    await beep(880, 0.16, "sine", 0.065);
    await new Promise((r) => setTimeout(r, 100));
    await beep(740, 0.2, "sine", 0.055);
    await new Promise((r) => setTimeout(r, 80));
    await beep(880, 0.14, "sine", 0.05);
  }, [beep]);

  const playMissed = useCallback(async () => {
    await beep(420, 0.15, "triangle", 0.05);
    await beep(280, 0.25, "triangle", 0.04);
  }, [beep]);

  const playSms = useCallback(async () => {
    await beep(980, 0.06, "sine", 0.05);
    await beep(1320, 0.08, "sine", 0.04);
  }, [beep]);

  const playNotify = useCallback(async () => {
    await beep(660, 0.08, "sine", 0.06);
    await beep(880, 0.12, "sine", 0.05);
  }, [beep]);

  const playConfirm = useCallback(async () => {
    await beep(523, 0.08, "sine", 0.05);
    await beep(659, 0.1, "sine", 0.05);
    await beep(784, 0.16, "sine", 0.045);
  }, [beep]);

  const stopVoice = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    const current = narrationRef.current;
    if (current) {
      current.pause();
      current.currentTime = 0;
      narrationRef.current = null;
    }
  }, []);

  const pickNaturalVoice = useCallback((loc: DemoLocale) => {
    const voices = window.speechSynthesis.getVoices();
    const rank = (v: SpeechSynthesisVoice) => {
      let score = 0;
      const n = v.name;
      if (/Neural|Natural|Online|Premium|Enhanced/i.test(n)) score += 50;
      if (loc === "fr") {
        if (/fr-CA|fr-FR|fr-/i.test(v.lang)) score += 40;
        if (/Antoine|Jean|Henri|Denise|Julie|Sylvie/i.test(n)) score += 30;
      } else {
        if (/en-US|en-CA/i.test(v.lang)) score += 40;
        if (/Andrew|Brian|Guy|Davis|Jason|Tony|Aria|Jenny/i.test(n)) score += 30;
      }
      if (/Google|Microsoft/i.test(n)) score += 8;
      return score;
    };
    return [...voices].sort((a, b) => rank(b) - rank(a))[0] ?? null;
  }, []);

  const speakFallback = useCallback(
    (sceneId: SceneId, loc: DemoLocale) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      stopVoice();
      const utter = new SpeechSynthesisUtterance(NARRATION[loc][sceneId]);
      utter.lang = loc === "fr" ? "fr-CA" : "en-US";
      utter.rate = 0.92;
      utter.pitch = 0.95;
      utter.volume = 1;
      const preferred = pickNaturalVoice(loc);
      if (preferred) utter.voice = preferred;
      window.speechSynthesis.speak(utter);
    },
    [pickNaturalVoice, stopVoice],
  );

  const cacheKey = (loc: DemoLocale, sceneId: SceneId) => `${loc}-${sceneId}`;

  const getNarrationAudio = useCallback(async (sceneId: SceneId, loc: DemoLocale) => {
    const key = cacheKey(loc, sceneId);
    const cached = narrationCache.current.get(key);
    if (cached) return cached;

    const known = mp3Available.current.get(key);
    if (known === false) return null;

    const src = `/demo-video/narration/${loc}/scene-${sceneId}.mp3`;
    try {
      const head = await fetch(src, { method: "HEAD" });
      if (!head.ok) {
        mp3Available.current.set(key, false);
        return null;
      }
    } catch {
      mp3Available.current.set(key, false);
      return null;
    }

    const audio = new Audio(src);
    audio.preload = "auto";
    narrationCache.current.set(key, audio);
    mp3Available.current.set(key, true);
    return audio;
  }, []);

  const speakScene = useCallback(
    async (sceneId: SceneId) => {
      if (!enabled || !voiceEnabledRef.current) return;
      const loc = localeRef.current;
      stopVoice();

      const audio = await getNarrationAudio(sceneId, loc);
      if (audio) {
        try {
          audio.currentTime = 0;
          narrationRef.current = audio;
          await audio.play();
          return;
        } catch {
          /* fall through */
        }
      }
      speakFallback(sceneId, loc);
    },
    [enabled, getNarrationAudio, speakFallback, stopVoice],
  );

  const onTimeline = useCallback(
    async (timeSec: number, sceneId: SceneId, playing: boolean) => {
      if (!enabled) return;

      if (!playing) {
        const current = narrationRef.current;
        if (current && !current.paused) current.pause();
        if (typeof window !== "undefined" && window.speechSynthesis?.speaking) {
          window.speechSynthesis.pause();
        }
        return;
      }

      const current = narrationRef.current;
      if (current && current.paused && lastSceneRef.current === sceneId) {
        void current.play().catch(() => undefined);
      }
      if (typeof window !== "undefined" && window.speechSynthesis?.paused) {
        window.speechSynthesis.resume();
      }

      if (timeSec >= 1 && musicNodesRef.current.length === 0) {
        await startMusic();
      }

      const loc = localeRef.current;
      const nearEnd = timeSec >= totalDurationSec(loc) - 3;
      const sceneStarts = scenesFor(loc).map((s) => s.start);
      if (nearEnd) setMusicLevel(0.006);
      else if (sceneId === 3) setMusicLevel(0.014);
      else if (sceneStarts.some((t) => Math.abs(timeSec - t) < 0.8)) setMusicLevel(0.036);
      else setMusicLevel(0.024);

      if (lastSceneRef.current !== sceneId) {
        lastSceneRef.current = sceneId;
        void speakScene(sceneId);
      }

      const sfx = lastSfxRef.current;
      const mark = (key: string, fn: () => void) => {
        if (!sfx.has(key)) {
          sfx.add(key);
          fn();
        }
      };

      const players: Record<string, () => void> = {
        ring1: () => void playRing(),
        ring2: () => void playRing(),
        missed: () => void playMissed(),
        sms1: () => void playSms(),
        sms2: () => void playSms(),
        notify: () => void playNotify(),
        confirm: () => void playConfirm(),
      };

      for (const cue of sfxMarks(loc)) {
        if (timeSec >= cue.start && timeSec < cue.end) {
          mark(cue.key, players[cue.key]);
        }
      }
    },
    [
      enabled,
      playConfirm,
      playMissed,
      playNotify,
      playRing,
      playSms,
      setMusicLevel,
      speakScene,
      startMusic,
    ],
  );

  const resetAudioMarks = useCallback(() => {
    lastSceneRef.current = null;
    lastSfxRef.current = new Set();
    stopVoice();
  }, [stopVoice]);

  // Reset narration when locale changes
  useEffect(() => {
    lastSceneRef.current = null;
    stopVoice();
  }, [locale, stopVoice]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.speechSynthesis?.getVoices();
    const onVoices = () => window.speechSynthesis.getVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", onVoices);

    for (let i = 1; i <= 8; i++) {
      void getNarrationAudio(i as SceneId, locale);
    }

    return () => {
      window.speechSynthesis?.removeEventListener("voiceschanged", onVoices);
      stopVoice();
      stopMusic();
      void ctxRef.current?.close().catch(() => undefined);
      ctxRef.current = null;
    };
  }, [getNarrationAudio, locale, stopMusic, stopVoice]);

  return {
    onTimeline,
    resetAudioMarks,
    stopVoice,
    stopMusic,
    setVoiceEnabled: (v: boolean) => {
      voiceEnabledRef.current = v;
      if (!v) stopVoice();
    },
  };
}
