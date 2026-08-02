"use client";

import {
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type MouseEvent,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  getCopy,
  sceneAt,
  sceneProgress,
  totalDurationMs,
  type DemoCopy,
  type DemoLocale,
  type SceneId,
} from "./timeline";
import { useTimelineClock } from "./useTimelineClock";
import { useDemoAudio } from "./useDemoAudio";
import { CaptionOverlay } from "./parts/CaptionOverlay";
import { PlaybackControls } from "./parts/PlaybackControls";
import { Scene1ContractorWork } from "./scenes/Scene1ContractorWork";
import { Scene2MissedCallSMS } from "./scenes/Scene2MissedCallSMS";
import { Scene3CustomerQualification } from "./scenes/Scene3CustomerQualification";
import { Scene4LeadSummary } from "./scenes/Scene4LeadSummary";
import { Scene5Appointment } from "./scenes/Scene5Appointment";
import { Scene6EstimateFollowUp } from "./scenes/Scene6EstimateFollowUp";
import { Scene7WeeklyResults } from "./scenes/Scene7WeeklyResults";
import { Scene8Closing } from "./scenes/Scene8Closing";

export type SceneProps = {
  /** Progress inside the current scene, 0 → 1. */
  p: number;
  locale: DemoLocale;
  copy: DemoCopy;
};

/**
 * The dashboard scenes are laid out at website scale; blown up to 1080p they
 * leave too much empty frame. Zoom them so the content carries the screen.
 * Scenes that show a phone stay at 1 — the frame is already height-capped.
 */
const SCENE_ZOOM: Record<SceneId, number> = {
  1: 1,
  2: 1,
  3: 1,
  4: 1.24,
  5: 1,
  6: 1.2,
  7: 1.18,
  8: 1.06,
};

const SCENE_COMPONENTS: Record<SceneId, ComponentType<SceneProps>> = {
  1: Scene1ContractorWork,
  2: Scene2MissedCallSMS,
  3: Scene3CustomerQualification,
  4: Scene4LeadSummary,
  5: Scene5Appointment,
  6: Scene6EstimateFollowUp,
  7: Scene7WeeklyResults,
  8: Scene8Closing,
};

function safeFullscreen(enter: boolean) {
  try {
    if (enter) {
      const el = document.documentElement;
      const req =
        el.requestFullscreen?.bind(el) ||
        (
          el as HTMLElement & {
            webkitRequestFullscreen?: () => Promise<void>;
          }
        ).webkitRequestFullscreen?.bind(el);
      void Promise.resolve(req?.()).catch(() => undefined);
    } else if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => undefined);
    }
  } catch {
    /* ignore */
  }
}

function DemoVideoExperienceInner() {
  const rawLocale = useLocale();
  const locale: DemoLocale = rawLocale === "fr" ? "fr" : "en";
  const tDemo = useTranslations("demoVideo");
  const copy = getCopy(locale);
  const searchParams = useSearchParams();
  const recording = searchParams.get("record") === "1";
  const voiceFromUrl = searchParams.get("voice") !== "0";

  const clock = useTimelineClock(totalDurationMs(locale));
  const [presentation, setPresentation] = useState(recording);
  const [voiceOn, setVoiceOn] = useState(voiceFromUrl);
  const [audioArmed, setAudioArmed] = useState(false);
  const audio = useDemoAudio(audioArmed && voiceOn, locale);

  const sceneId = sceneAt(clock.timeSec, locale);
  const p = sceneProgress(clock.timeSec, sceneId, locale);
  const Scene = SCENE_COMPONENTS[sceneId];

  useEffect(() => {
    document.body.classList.add("demo-video-active");
    return () => document.body.classList.remove("demo-video-active");
  }, []);

  useEffect(() => {
    audio.setVoiceEnabled(voiceOn);
  }, [audio, voiceOn]);

  useEffect(() => {
    void audio.onTimeline(clock.timeSec, sceneId, clock.playing);
  }, [audio, clock.playing, clock.timeSec, sceneId]);

  const armAndPlay = () => {
    setAudioArmed(true);
    clock.play();
  };

  const armAndRestart = () => {
    setAudioArmed(true);
    audio.resetAudioMarks();
    clock.restart();
  };

  const togglePlayPause = () => {
    if (clock.playing) clock.pause();
    else armAndPlay();
  };

  const togglePresentation = () => {
    setPresentation((v) => {
      const next = !v;
      safeFullscreen(next);
      return next;
    });
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.code === "Space") {
        e.preventDefault();
        if (clock.playing) clock.pause();
        else {
          setAudioArmed(true);
          clock.play();
        }
      }
      if (e.key === "r" || e.key === "R") {
        setAudioArmed(true);
        audio.resetAudioMarks();
        clock.restart();
      }
      if (e.key === "f" || e.key === "F" || e.key === "p" || e.key === "P") {
        setPresentation((v) => {
          const next = !v;
          safeFullscreen(next);
          return next;
        });
      }
      if (e.key === "Escape") {
        setPresentation(false);
        safeFullscreen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [audio, clock]);

  const onStageClick = (e: MouseEvent<HTMLDivElement>) => {
    if (recording) return;
    const target = e.target as HTMLElement;
    if (target.closest("a, button, input, label")) return;
    togglePlayPause();
  };

  return (
    <div className="fixed inset-0 z-[200] bg-[#0c141e] text-white">
      <div
        className={`absolute inset-0 flex items-center justify-center ${
          recording ? "" : "pb-[120px]"
        }`}
      >
        <div
          role="button"
          tabIndex={0}
          aria-label={clock.playing ? tDemo("pause") : tDemo("play")}
          onClick={onStageClick}
          onKeyDown={(e) => {
            if (e.key === "Enter") togglePlayPause();
          }}
          className={`relative overflow-hidden bg-[#0c141e] outline-none ${
            recording ? "cursor-default" : "cursor-pointer"
          } ${
            presentation
              ? "h-full w-full"
              : "h-[min(100vh-140px,100vw*9/16)] w-[min(100vw,calc((100vh-140px)*16/9))]"
          }`}
          style={{ aspectRatio: presentation ? undefined : "16 / 9" }}
        >
          <div
            className="absolute inset-0"
            style={{
              transform: `scale(${SCENE_ZOOM[sceneId]})`,
              transformOrigin: "50% 44%",
            }}
          >
            <Scene p={p} locale={locale} copy={copy} />
          </div>
          <CaptionOverlay
            timeSec={clock.timeSec}
            locale={locale}
            raised={!presentation}
          />

          {!recording && !clock.playing && clock.timeMs === 0 ? (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0c141e]/88">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  armAndPlay();
                }}
                className="min-h-[56px] rounded-lg bg-orange px-10 py-4 font-heading text-[20px] font-extrabold tracking-[-0.02em] text-navy shadow-[0_14px_34px_-16px_rgba(228,118,43,0.8)] hover:bg-orange-dark"
              >
                {copy.playDemo}
              </button>
            </div>
          ) : null}

          {!recording && !clock.playing && clock.timeMs > 0 && !clock.ended ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <div className="rounded-full bg-black/45 px-5 py-3 text-[15px] font-semibold text-white/90 backdrop-blur-sm">
                {copy.clickToPlay}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {recording ? null : (
        <>
          <PlaybackControls
            timeMs={clock.timeMs}
            durationMs={clock.durationMs}
            playing={clock.playing}
            ended={clock.ended}
            presentation={presentation}
            voiceOn={voiceOn}
            copy={copy}
            onPlay={armAndPlay}
            onPause={clock.pause}
            onRestart={armAndRestart}
            onSeek={(ms) => {
              audio.resetAudioMarks();
              clock.seek(ms);
            }}
            onTogglePresentation={togglePresentation}
            onToggleVoice={() => setVoiceOn((v) => !v)}
          />

          {presentation ? (
            <button
              type="button"
              onClick={togglePresentation}
              className="absolute top-3 right-3 z-50 min-h-[40px] rounded-lg bg-black/50 px-3 py-2 text-[13px] text-white/70 hover:text-white"
            >
              {copy.exit}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

export function DemoVideoExperience() {
  return (
    <Suspense fallback={<div className="fixed inset-0 z-[200] bg-[#0c141e]" />}>
      <DemoVideoExperienceInner />
    </Suspense>
  );
}
