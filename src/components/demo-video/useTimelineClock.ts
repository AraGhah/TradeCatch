"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useTimelineClock(durationMs: number) {
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const playingRef = useRef(false);
  const timeRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);
  const durationRef = useRef(durationMs);
  const tickRef = useRef<(now: number) => void>(() => {});

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastRef.current = null;
  }, []);

  useEffect(() => {
    durationRef.current = durationMs;
  }, [durationMs]);

  useEffect(() => {
    tickRef.current = (now: number) => {
      if (!playingRef.current) return;
      if (lastRef.current == null) lastRef.current = now;
      const delta = now - lastRef.current;
      lastRef.current = now;
      const limit = durationRef.current;
      const next = Math.min(limit, timeRef.current + delta);
      timeRef.current = next;
      setTimeMs(next);
      if (next >= limit) {
        playingRef.current = false;
        setPlaying(false);
        setEnded(true);
        stopRaf();
        return;
      }
      rafRef.current = requestAnimationFrame((t) => tickRef.current(t));
    };
  }, [stopRaf]);

  const play = useCallback(() => {
    if (timeRef.current >= durationMs) {
      timeRef.current = 0;
      setTimeMs(0);
      setEnded(false);
    }
    playingRef.current = true;
    setPlaying(true);
    setEnded(false);
    stopRaf();
    rafRef.current = requestAnimationFrame((t) => tickRef.current(t));
  }, [durationMs, stopRaf]);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    stopRaf();
  }, [stopRaf]);

  const restart = useCallback(() => {
    stopRaf();
    timeRef.current = 0;
    setTimeMs(0);
    setEnded(false);
    playingRef.current = true;
    setPlaying(true);
    rafRef.current = requestAnimationFrame((t) => tickRef.current(t));
  }, [stopRaf]);

  const seek = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(durationMs, ms));
      timeRef.current = clamped;
      setTimeMs(clamped);
      setEnded(clamped >= durationMs);
    },
    [durationMs],
  );

  useEffect(() => () => stopRaf(), [stopRaf]);

  return {
    timeMs,
    timeSec: timeMs / 1000,
    playing,
    ended,
    progress: timeMs / durationMs,
    play,
    pause,
    restart,
    seek,
    durationMs,
  };
}
