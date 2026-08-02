"use client";

import { useTranslations } from "next-intl";
import { formatClock, type DemoCopy } from "../timeline";

export function PlaybackControls({
  timeMs,
  durationMs,
  playing,
  ended,
  presentation,
  voiceOn,
  copy,
  onPlay,
  onPause,
  onRestart,
  onSeek,
  onTogglePresentation,
  onToggleVoice,
}: {
  timeMs: number;
  durationMs: number;
  playing: boolean;
  ended: boolean;
  presentation: boolean;
  voiceOn: boolean;
  copy: DemoCopy;
  onPlay: () => void;
  onPause: () => void;
  onRestart: () => void;
  onSeek: (ms: number) => void;
  onTogglePresentation: () => void;
  onToggleVoice: () => void;
}) {
  const t = useTranslations("demoVideo");
  if (presentation) return null;

  const btn =
    "min-h-[44px] rounded-lg px-4 py-2.5 text-[15px] font-semibold transition active:scale-[0.98]";
  const secondary = `${btn} border border-white/20 bg-white/[0.06] text-white hover:bg-white/12`;

  return (
    <div className="absolute inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[rgba(12,20,30,0.94)] px-4 py-4 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-3">
        <input
          type="range"
          min={0}
          max={durationMs}
          step={100}
          value={timeMs}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="h-3 w-full cursor-pointer accent-orange"
          aria-label={t("timelineProgress")}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={playing ? onPause : onPlay}
            className={`${btn} min-w-[108px] bg-orange text-navy shadow-[0_10px_24px_-12px_rgba(228,118,43,0.9)] hover:bg-orange-dark`}
          >
            {ended ? copy.replay : playing ? copy.pause : copy.play}
          </button>
          <button type="button" onClick={onRestart} className={secondary}>
            {copy.restart}
          </button>
          <button type="button" onClick={onTogglePresentation} className={secondary}>
            {copy.fullScreen}
          </button>
          <button type="button" onClick={onToggleVoice} className={secondary}>
            {voiceOn ? copy.voiceOn : copy.voiceOff}
          </button>
          <span className="ml-auto font-mono text-[14px] text-white/60 tabular-nums">
            {formatClock(timeMs)} / {formatClock(durationMs)}
          </span>
        </div>
        <p className="text-[12px] text-white/40">{copy.tip}</p>
      </div>
    </div>
  );
}
