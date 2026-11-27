"use client";

import {
  BatteryFull,
  CalendarCheck,
  Check,
  ClipboardCheck,
  LayoutDashboard,
  LoaderCircle,
  MessageSquareText,
  Pause,
  Phone,
  PhoneIncoming,
  Play,
  Signal,
  UserRound,
  Wifi,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Every line the phone shows, already translated and already chosen for the
 * scheduling flag by the server parent, so this file never decides what the
 * product promises.
 */
export type CallJourneyCopy = {
  incoming: string;
  caller: string;
  callerLine: string;
  answeredBy: string;
  onCall: string;
  callEnded: string;
  speakerCaller: string;
  speakerAgent: string;
  caller1: string;
  agent1: string;
  caller2: string;
  agent2: string;
  qualifyTitle: string;
  /** Label and captured value, in the order they are ticked off. */
  facts: [string, string][];
  /** Booked: checking the calendar. Request: sending it to the team. */
  stepTitle: string;
  stepWorking: string;
  /** Booked only: three slots, the first is taken, the second is picked. */
  slots: [string, string, string] | null;
  slotTaken: string;
  stepDone: string;
  stepDoneNote: string;
  notifyApp: string;
  notifyNow: string;
  newBadge: string;
  notifyTitle: string;
  notifyBody: string;
  dashTitle: string;
  dashNew: string;
  dashNewMeta: string;
  dashOld: [string, string][];
  rail: { title: string; detail: string }[];
  pause: string;
  play: string;
};

type Scene = "ring" | "talk" | "qualify" | "step" | "notify";

/**
 * The loop, beat by beat: which screen shows, how far into it the story is,
 * which rail step is lit, who is speaking, and how long the beat holds (ms).
 * About 1 s per 8 words of a new line, a longer rest on the result.
 */
type Beat = { scene: Scene; sub: number; rail: number; voice: 0 | 1 | 2; ms: number };

function beatsFor(booking: boolean): Beat[] {
  const done = 4;
  return [
    { scene: "ring", sub: 0, rail: 0, voice: 0, ms: 2400 },
    { scene: "talk", sub: 0, rail: 0, voice: 2, ms: 1300 },
    { scene: "talk", sub: 1, rail: 1, voice: 1, ms: 1900 },
    { scene: "talk", sub: 2, rail: 1, voice: 2, ms: 1900 },
    { scene: "talk", sub: 3, rail: 1, voice: 1, ms: 1800 },
    { scene: "talk", sub: 4, rail: 1, voice: 2, ms: 1900 },
    { scene: "qualify", sub: 0, rail: 2, voice: 2, ms: 600 },
    { scene: "qualify", sub: 1, rail: 2, voice: 2, ms: 550 },
    { scene: "qualify", sub: 2, rail: 2, voice: 1, ms: 550 },
    { scene: "qualify", sub: 3, rail: 2, voice: 2, ms: 550 },
    { scene: "qualify", sub: 4, rail: 2, voice: 2, ms: 1300 },
    { scene: "step", sub: 0, rail: 3, voice: 2, ms: 1200 },
    { scene: "step", sub: 1, rail: 3, voice: 2, ms: booking ? 1300 : 600 },
    { scene: "step", sub: 2, rail: 3, voice: 0, ms: 1900 },
    { scene: "notify", sub: 0, rail: done, voice: 0, ms: 900 },
    { scene: "notify", sub: 1, rail: done, voice: 0, ms: 3600 },
  ];
}

/** Waveform bars: a resting height and a speed, uneven so they never march in step. */
const BARS = [
  [0.45, 0.92], [0.7, 1.18], [0.55, 0.81], [0.9, 1.07], [0.6, 0.73],
  [1, 1.24], [0.75, 0.88], [0.5, 1.02], [0.85, 0.77], [0.65, 1.15],
  [0.95, 0.84], [0.55, 0.96], [0.8, 1.21], [0.6, 0.79], [0.9, 1.09],
  [0.5, 0.87], [0.7, 1.13], [0.45, 0.8], [0.6, 0.99], [0.4, 1.17],
] as const;

function Waveform({ voice, paused }: { voice: 0 | 1 | 2; paused: boolean }) {
  return (
    <div
      aria-hidden
      data-voice={voice}
      className="tc-voice flex h-9 items-center justify-between gap-[3px]"
    >
      {BARS.map(([height, speed], index) => (
        <span
          key={index}
          className={cn(
            "tc-voice-bar block w-[3px] origin-center rounded-full",
            voice === 1 ? "bg-[#f5b544]" : "bg-orange",
          )}
          style={{
            height: `${Math.round(height * 100)}%`,
            animationDuration: `${speed}s`,
            animationDelay: `${-(index * 0.137) % speed}s`,
            animationPlayState: paused ? "paused" : "running",
          }}
        />
      ))}
    </div>
  );
}

/** One screen of the phone; only the current one is visible, the rest fade. */
function Screen({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden
      className={cn(
        "absolute inset-0 flex flex-col px-3.5 pt-1 pb-6 transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none",
        show ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0",
      )}
    >
      {children}
    </div>
  );
}

function Bubble({ who, show, label, children }: { who: "caller" | "agent"; show: boolean; label: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-col transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none",
        who === "agent" ? "items-end" : "items-start",
        show ? "opacity-100" : "h-0 translate-y-1.5 overflow-hidden opacity-0",
      )}
    >
      <span className="mb-0.5 px-1 text-[9.5px] font-semibold text-white/55">{label}</span>
      <p
        className={cn(
          "m-0 max-w-[88%] rounded-2xl px-3 py-1.5 text-[11.5px] leading-[1.4]",
          who === "agent"
            ? "rounded-br-md bg-orange text-navy"
            : "rounded-bl-md bg-white/12 text-white",
        )}
      >
        {children}
      </p>
    </div>
  );
}

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The home page phone: one call, start to finish, on a loop. It rings, the
 * receptionist answers and talks with the caller, qualifies the job, books it
 * (or hands it to the team when scheduling is not advertised) and the owner
 * gets the notification. The rail beside it shows where that information goes.
 * It pauses off screen, in a hidden tab, on the pause button, and never moves
 * for visitors who ask for reduced motion.
 */
export function CallJourneyPhone({ copy, booking }: { copy: CallJourneyCopy; booking: boolean }) {
  const beats = beatsFor(booking);
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reduced, setReduced] = useState(false);
  /** Reduced motion holds a still frame until the visitor presses play. */
  const [reducedPlay, setReducedPlay] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setReduced(media.matches);
      // A still frame that tells the whole story: the job on the dashboard.
      if (media.matches) setIndex(beats.length - 1);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
    // beats.length is fixed for a given `booking`.
  }, [beats.length]);

  useEffect(() => {
    const el = root.current;
    let offscreen = false;
    const update = () => setHidden(offscreen || document.hidden);
    const observer =
      el && "IntersectionObserver" in window
        ? new IntersectionObserver(([entry]) => {
            offscreen = !entry?.isIntersecting;
            update();
          })
        : null;
    if (el) observer?.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const paused = userPaused || hidden || (reduced && !reducedPlay);
  const beat = beats[index]!;

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => {
      const next = (index + 1) % beats.length;
      // Back to the ring: the next call's timer starts from zero.
      if (next === 0) setSeconds(0);
      setIndex(next);
    }, beat.ms);
    return () => window.clearTimeout(timer);
  }, [index, paused, beat.ms, beats.length]);

  const live = beat.scene !== "ring" && beat.scene !== "notify";
  useEffect(() => {
    if (!live || paused) return;
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [live, paused]);

  const at = (scene: Scene, sub = 0) =>
    beat.scene === scene && beat.sub >= sub;
  const shownFacts = beat.scene === "qualify" ? beat.sub : beat.scene === "step" || beat.scene === "notify" ? copy.facts.length : 0;
  const callSeconds = beat.scene === "notify" ? Math.max(seconds, 1) : seconds;

  function toggle() {
    if (reduced && !reducedPlay) {
      // The visitor asked to watch it: play from the first ring.
      setReducedPlay(true);
      setUserPaused(false);
      setSeconds(0);
      setIndex(0);
      return;
    }
    setUserPaused((p) => !p);
  }

  return (
    <div ref={root} className="relative">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-center sm:gap-6">
        {/* Phone */}
        <div
          data-motion="phone"
          className="relative w-full max-w-[300px] shrink-0 rounded-[46px] bg-navy p-[9px] shadow-[0_40px_70px_-34px_rgb(var(--ink-rgb)/0.6),0_0_0_1px_rgb(var(--ink-rgb)/0.25),inset_0_0_0_1.5px_rgb(255_255_255/0.08)]"
        >
          {/* Side buttons */}
          <span aria-hidden className="absolute top-[110px] -left-[3px] h-10 w-[3px] rounded-l bg-navy-light" />
          <span aria-hidden className="absolute top-[160px] -left-[3px] h-14 w-[3px] rounded-l bg-navy-light" />
          <span aria-hidden className="absolute top-[130px] -right-[3px] h-16 w-[3px] rounded-r bg-navy-light" />

          <div className="relative aspect-[9/18.5] overflow-hidden rounded-[38px] bg-[#101b27] text-white">
            {/* Status bar and island */}
            <div aria-hidden className="relative z-20 flex h-9 items-center justify-between px-6 pt-1 text-[11px] font-semibold">
              <span className="tabular-nums">9:41</span>
              <span className="absolute top-2 left-1/2 h-[22px] w-[86px] -translate-x-1/2 rounded-full bg-black" />
              <span className="flex items-center gap-1">
                <Signal className="h-3 w-3" strokeWidth={2.4} />
                <Wifi className="h-3 w-3" strokeWidth={2.4} />
                <BatteryFull className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
            </div>

            <div className="absolute inset-x-0 top-9 bottom-0">
              {/* 1. Ringing */}
              <Screen show={beat.scene === "ring"}>
                <div className="flex flex-1 flex-col items-center pt-8 text-center">
                  <p className="m-0 text-[11.5px] text-white/60">{copy.incoming}</p>
                  <span className="relative mt-6 flex h-20 w-20 items-center justify-center">
                    <span className={cn("absolute inset-0 rounded-full bg-orange/30", !paused && "tc-ring")} />
                    <span className={cn("absolute inset-2 rounded-full bg-orange/30", !paused && "tc-ring [animation-delay:0.5s]")} />
                    <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
                      <UserRound className="h-8 w-8 text-white/85" strokeWidth={1.6} />
                    </span>
                  </span>
                  <p className="m-0 mt-5 text-[19px] font-bold tracking-[-0.01em]">{copy.caller}</p>
                  <p className="m-0 mt-1 text-[11.5px] text-white/60">{copy.callerLine}</p>
                  <div className="mt-auto mb-6 flex items-center gap-2 rounded-full bg-white/8 px-3 py-1.5 text-[11px] text-white/80">
                    <PhoneIncoming className={cn("h-3.5 w-3.5 text-orange", !paused && "tc-shake")} strokeWidth={2.2} />
                    {copy.answeredBy}
                  </div>
                </div>
              </Screen>

              {/* 2 to 4. The live call: conversation, qualification, booking */}
              <Screen show={live}>
                <div className="flex items-center gap-2.5 rounded-2xl bg-white/[0.06] px-3 py-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange text-navy">
                    <Phone className="h-4 w-4" strokeWidth={2.2} />
                  </span>
                  <p className="m-0 min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[12.5px] font-bold">{copy.caller}</span>
                    <span className="flex items-center gap-1.5 text-[10.5px] text-white/60">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#4ade80]" />
                      {copy.onCall} · <span className="tabular-nums">{clock(callSeconds)}</span>
                    </span>
                  </p>
                </div>

                <div className="mt-2.5 rounded-2xl bg-white/[0.04] px-3 pt-1.5 pb-2">
                  <p className="m-0 mb-0.5 text-[9.5px] font-semibold text-white/50">
                    {beat.voice === 1 ? copy.speakerCaller : beat.voice === 2 ? copy.speakerAgent : " "}
                  </p>
                  <Waveform voice={beat.voice} paused={paused} />
                </div>

                {/* Conversation, then the qualification card, then the booking card */}
                <div className="relative mt-2.5 min-h-0 flex-1">
                  <div
                    className={cn(
                      "absolute inset-0 flex flex-col justify-end gap-1.5 transition-opacity duration-[400ms] motion-reduce:transition-none",
                      beat.scene === "talk" ? "opacity-100" : "opacity-0",
                    )}
                  >
                    <Bubble who="caller" show={at("talk", 1)} label={copy.speakerCaller}>{copy.caller1}</Bubble>
                    <Bubble who="agent" show={at("talk", 2)} label={copy.speakerAgent}>{copy.agent1}</Bubble>
                    <Bubble who="caller" show={at("talk", 3)} label={copy.speakerCaller}>{copy.caller2}</Bubble>
                    <Bubble who="agent" show={at("talk", 4)} label={copy.speakerAgent}>{copy.agent2}</Bubble>
                  </div>

                  <div
                    className={cn(
                      "absolute inset-x-0 bottom-0 flex flex-col gap-2 transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none",
                      beat.scene === "qualify" || beat.scene === "step" ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
                    )}
                  >
                    <div className="rounded-2xl bg-white px-3 py-2.5 text-navy">
                      <p className="m-0 flex items-center gap-1.5 text-[11px] font-bold">
                        <ClipboardCheck className="h-3.5 w-3.5 text-ember-text" strokeWidth={2.2} />
                        {copy.qualifyTitle}
                      </p>
                      <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
                        {copy.facts.map(([label, value], i) => {
                          const ok = i < shownFacts;
                          return (
                            <li key={label} className="flex items-center gap-2 text-[10.5px]">
                              <span
                                className={cn(
                                  "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full transition-colors duration-300",
                                  ok ? "bg-signal-text text-white" : "border border-navy/20",
                                )}
                              >
                                {ok ? <Check className="h-2.5 w-2.5" strokeWidth={3.2} /> : null}
                              </span>
                              <span className="text-navy/60">{label}</span>
                              <span
                                className={cn(
                                  "ml-auto truncate font-semibold transition-opacity duration-300",
                                  ok ? "opacity-100" : "opacity-0",
                                )}
                              >
                                {value}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    <div
                      className={cn(
                        "rounded-2xl bg-white px-3 py-2.5 text-navy transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none",
                        beat.scene === "step" ? "translate-y-0 opacity-100" : "h-0 translate-y-2 overflow-hidden py-0 opacity-0",
                      )}
                    >
                      <p className="m-0 flex items-center gap-1.5 text-[11px] font-bold">
                        {at("step", 2) ? (
                          <Check className="h-3.5 w-3.5 text-signal-text" strokeWidth={2.8} />
                        ) : (
                          <LoaderCircle className={cn("h-3.5 w-3.5 text-ember-text", !paused && "animate-spin")} strokeWidth={2.2} />
                        )}
                        {at("step", 2) ? copy.stepDone : copy.stepTitle}
                      </p>
                      {copy.slots ? (
                        <div className="mt-1.5 grid grid-cols-3 gap-1">
                          {copy.slots.map((slot, i) => (
                            <span
                              key={slot}
                              className={cn(
                                "rounded-lg border px-1 py-1 text-center text-[9.5px] leading-tight font-semibold transition-colors duration-300",
                                i === 0
                                  ? "border-navy/10 bg-navy/[0.04] text-navy/40 line-through"
                                  : i === 1 && at("step", 1)
                                    ? "border-orange bg-orange text-navy"
                                    : "border-navy/15 text-navy/80",
                              )}
                            >
                              {slot}
                              {i === 0 ? <span className="block text-[8.5px] font-medium no-underline">{copy.slotTaken}</span> : null}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="m-0 mt-1 text-[10.5px] text-navy/65">{copy.stepWorking}</p>
                      )}
                      <p
                        className={cn(
                          "m-0 mt-1.5 flex items-center gap-1 text-[10px] text-signal-text transition-opacity duration-300",
                          at("step", 2) ? "opacity-100" : "opacity-0",
                        )}
                      >
                        <MessageSquareText className="h-3 w-3" strokeWidth={2.2} />
                        {copy.stepDoneNote}
                      </p>
                    </div>
                  </div>
                </div>
              </Screen>

              {/* 5. The owner's notification and dashboard */}
              <Screen show={beat.scene === "notify"}>
                <div
                  className={cn(
                    "rounded-2xl bg-white/95 px-3 py-2.5 text-navy shadow-[0_10px_24px_-12px_rgb(0_0_0/0.6)] transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none",
                    beat.scene === "notify" ? "translate-y-0 opacity-100" : "-translate-y-4 opacity-0",
                  )}
                >
                  <p className="m-0 flex items-center gap-1.5 text-[9.5px] font-semibold text-navy/55">
                    <span className="flex h-4 w-4 items-center justify-center rounded-[5px] bg-orange text-navy">
                      <CalendarCheck className="h-2.5 w-2.5" strokeWidth={2.6} />
                    </span>
                    {copy.notifyApp}
                    <span className="ml-auto font-normal">{copy.notifyNow}</span>
                  </p>
                  <p className="m-0 mt-1 text-[12px] font-bold">{copy.notifyTitle}</p>
                  <p className="m-0 text-[11px] text-navy/70">{copy.notifyBody}</p>
                </div>

                <div className="mt-3 flex-1 rounded-2xl bg-white px-3 py-2.5 text-navy">
                  <p className="m-0 flex items-center gap-1.5 text-[11px] font-bold">
                    <LayoutDashboard className="h-3.5 w-3.5 text-ember-text" strokeWidth={2.2} />
                    {copy.dashTitle}
                  </p>
                  <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                    <li
                      className={cn(
                        "rounded-lg border px-2.5 py-1.5 transition-colors duration-700",
                        at("notify", 1) ? "border-orange/60 bg-orange/10" : "border-navy/10",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2 text-[11px] font-semibold">
                        {copy.dashNew}
                        <span className="rounded-full bg-orange px-1.5 py-px text-[8.5px] font-bold text-navy">{copy.newBadge}</span>
                      </span>
                      <span className="block text-[10px] text-navy/60">{copy.dashNewMeta}</span>
                    </li>
                    {copy.dashOld.map(([title, meta]) => (
                      <li key={title} className="rounded-lg border border-navy/10 px-2.5 py-1.5">
                        <span className="block text-[11px] font-semibold text-navy/80">{title}</span>
                        <span className="block text-[10px] text-navy/55">{meta}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="m-0 mt-2 text-center text-[10px] text-white/50">
                  {copy.callEnded} · <span className="tabular-nums">{clock(callSeconds)}</span>
                </p>
              </Screen>
            </div>

            <span aria-hidden className="absolute bottom-1.5 left-1/2 z-20 h-1 w-24 -translate-x-1/2 rounded-full bg-white/35" />
          </div>
        </div>

        {/* Where the information goes */}
        <ol aria-hidden className="m-0 grid w-full max-w-[300px] list-none grid-cols-2 gap-2 p-0 sm:flex sm:w-[188px] sm:max-w-none sm:flex-col sm:gap-0">
          {copy.rail.map((step, i) => {
            const state = i < beat.rail || (i === beat.rail && beat.scene === "notify") ? "done" : i === beat.rail ? "active" : "next";
            const last = i === copy.rail.length - 1;
            return (
              <li key={step.title} data-motion="stage" className={cn("relative flex gap-2.5 sm:pb-4", last && "sm:pb-0")}>
                {!last ? (
                  <span className="absolute top-7 bottom-0 left-[13px] hidden w-px overflow-hidden bg-navy/15 sm:block">
                    <span
                      className={cn(
                        "block w-full origin-top bg-orange transition-transform duration-500 ease-out motion-reduce:transition-none",
                        state === "done" ? "h-full scale-y-100" : "h-full scale-y-0",
                      )}
                    />
                  </span>
                ) : null}
                <span
                  className={cn(
                    "relative flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full border text-[11px] font-bold transition-colors duration-300",
                    state === "done" && "border-navy bg-navy text-white",
                    state === "active" && "border-orange bg-orange text-navy",
                    state === "next" && "border-navy/20 bg-surface text-navy/45",
                  )}
                >
                  {state === "active" && !paused ? <span className="absolute inset-0 rounded-full bg-orange/40 tc-ring" /> : null}
                  {state === "done" ? <Check className="relative h-3.5 w-3.5" strokeWidth={3} /> : <span className="relative">{i + 1}</span>}
                </span>
                <span className="min-w-0 pt-0.5 leading-tight">
                  <span className={cn("block text-[12.5px] font-bold transition-colors", state === "next" ? "text-muted" : "text-heading")}>
                    {step.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted">{step.detail}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <button
        type="button"
        onClick={toggle}
        className="absolute -top-1 right-0 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgb(var(--ink-rgb)/0.15)] bg-surface text-heading shadow-sm hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/50"
      >
        {paused ? <Play className="h-3.5 w-3.5" strokeWidth={2.4} /> : <Pause className="h-3.5 w-3.5" strokeWidth={2.4} />}
        <span className="sr-only">{paused ? copy.play : copy.pause}</span>
      </button>
    </div>
  );
}
