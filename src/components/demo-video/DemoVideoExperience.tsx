"use client";

import {
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type MouseEvent,
} from "react";
import { useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  getCopy,
  isDemoCut,
  sceneAt,
  totalDurationMs,
  type DemoCopy,
  type DemoCut,
  type DemoLocale,
  type SceneKey,
  type SceneWindow,
} from "./timeline";
import { useTimelineClock } from "./useTimelineClock";
import { useDemoAudio } from "./useDemoAudio";
import { CaptionOverlay } from "./parts/CaptionOverlay";
import { PlaybackControls } from "./parts/PlaybackControls";
import { AnswerScene } from "./scenes/AnswerScene";
import { ClosingScene } from "./scenes/ClosingScene";
import { ContractorScene } from "./scenes/ContractorScene";
import { FollowUpsScene } from "./scenes/FollowUpsScene";
import { LeadCapturedScene } from "./scenes/LeadCapturedScene";
import { LiveCallScene } from "./scenes/LiveCallScene";
import { QuoteFollowUpScene } from "./scenes/QuoteFollowUpScene";
import { TextBackScene } from "./scenes/TextBackScene";
import { TransferScene } from "./scenes/TransferScene";
import { WorkspaceScene } from "./scenes/WorkspaceScene";

export type SceneProps = {
  /** Progress inside the current scene, 0 → 1. */
  p: number;
  /** Seconds since the scene started; dialogue scenes key beats to lines. */
  sec: number;
  scene: SceneWindow;
  cut: DemoCut;
  locale: DemoLocale;
  copy: DemoCopy;
};

/**
 * The dashboard scenes are laid out at website scale; blown up to 1080p they
 * leave too much empty frame. Zoom them so the content carries the screen.
 * Scenes that show a phone stay at 1 — the frame is already height-capped.
 */
const SCENE_ZOOM: Record<SceneKey, number> = {
  contractor: 1,
  answer: 1.08,
  liveCall: 1.08,
  transfer: 1.1,
  workspace: 1.12,
  followUps: 1.12,
  closing: 1.06,
  textBack: 1,
  leadCaptured: 1.14,
  quoteFollowUp: 1.2,
};

const SCENE_COMPONENTS: Record<SceneKey, ComponentType<SceneProps>> = {
  contractor: ContractorScene,
  answer: AnswerScene,
  liveCall: LiveCallScene,
  transfer: TransferScene,
  workspace: WorkspaceScene,
  followUps: FollowUpsScene,
  closing: ClosingScene,
  textBack: TextBackScene,
  leadCaptured: LeadCapturedScene,
  quoteFollowUp: QuoteFollowUpScene,
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
  const searchParams = useSearchParams();
  const rawCut = searchParams.get("cut");
  const cut: DemoCut = isDemoCut(rawCut) ? rawCut : "platform";
  const copy = getCopy(cut, locale);
  const recording = searchParams.get("record") === "1";
  const voiceFromUrl = searchParams.get("voice") !== "0";

  const clock = useTimelineClock(totalDurationMs(cut, locale));
  const [presentation, setPresentation] = useState(recording);
  const [voiceOn, setVoiceOn] = useState(voiceFromUrl);
  const [audioArmed, setAudioArmed] = useState(false);
  const audio = useDemoAudio(audioArmed && voiceOn, cut, locale);

  const scene = sceneAt(clock.timeSec, cut, locale);
  const sec = Math.max(0, clock.timeSec - scene.start);
  const p = Math.min(1, sec / scene.duration);
  const sceneId = scene.index;
  const Scene = SCENE_COMPONENTS[scene.key];

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
          onClick={onStageClick}
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
              transform: `scale(${SCENE_ZOOM[scene.key]})`,
              transformOrigin: "50% 44%",
            }}
          >
            <Scene
              p={p}
              sec={sec}
              scene={scene}
              cut={cut}
              locale={locale}
              copy={copy}
            />
          </div>
          <p className="pointer-events-none absolute top-[2.5%] left-[2%] z-40 rounded-md border border-white/15 bg-black/35 px-3 py-1.5 font-mono text-[clamp(11px,0.85vw,14px)] tracking-[0.08em] text-white/70 uppercase">
            {copy.illustrative}
          </p>
          <CaptionOverlay
            timeSec={clock.timeSec}
            cut={cut}
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
