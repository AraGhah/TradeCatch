"use client";

import {
  BatteryFull,
  CalendarCheck,
  Check,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LoaderCircle,
  MessageSquareText,
  Pause,
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  Play,
  Signal,
  UserRound,
  Wifi,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

/**
 * Every line the phone shows, already translated and already chosen for the
 * launch flags by the server parent, so this file never decides what the
 * product promises. `transfer` is present only when the operator has switched
 * live transfer on; otherwise the caller who asks for a person gets the
 * callback the product really offers.
 */
export type ReceptionistCallCopy = {
  screenLabel: string;
  summaryText: string;
  incoming: string;
  line: string;
  caller: string;
  callerLine: string;
  answering: string;
  answered: string;
  onCall: string;
  onHold: string;
  callEnded: string;
  speakerAgent: string;
  speakerCaller: string;
  /** The conversation, in order, already chosen for the flags. */
  lines: { who: "agent" | "caller"; text: string }[];
  /**
   * Where in `lines` each moment of the story happens (see script()): the
   * caller states the need, then the urgency, then the remaining details; the
   * receptionist starts the calendar check or the request (workStart), offers
   * times (booking only), the caller picks, it is booked or sent (workEnd),
   * and the receptionist answers the request for a person (handoff).
   */
  marks: {
    need: number;
    urgency: number;
    details: number;
    workStart: number;
    offer: number | null;
    pick: number;
    workEnd: number;
    handoff: number;
  };
  detailsTitle: string;
  /** Label and captured value, ticked off as the caller says them. */
  fields: [string, string][];
  work: {
    title: [string, string, string, string];
    /** Booking: three calendar slots (the first is busy). Request: the rows. */
    items: [string, string, string];
    busy: string;
  };
  handoff: {
    title: [string, string];
    rows: [string, string, string];
  };
  notifyApp: string;
  notifyNow: string;
  notifyTitle: string;
  notifyBody: string;
  appTitle: string;
  appToday: string;
  summaryTitle: string;
  summaryBy: string;
  rows: [string, string][];
  /** The row that tells the outcome; drawn in green. */
  outcomeRow: number;
  chips: string[];
  earlier: [string, string];
  noticeLeft: string;
  noticeRight: string;
  pause: string;
  play: string;
};

type Stage = "ring" | "talk" | "ended" | "summary";
/** hold: the caller waits while the owner's phone rings; brief: the receptionist
 *  briefs the owner while the caller still waits. Once connected, the caller
 *  talks with the owner and the receptionist is quiet. */
type Voice = "agent" | "caller" | "none" | "hold" | "brief";
type Beat = {
  stage: Stage;
  /** The last transcript line shown (-1: none yet). */
  line: number;
  voice: Voice;
  /** How many details are ticked off. */
  fields: number;
  /** Which card sits under the transcript, and how far along it is. */
  dock: "details" | "work" | "handoff";
  step: number;
  phase: "call" | "card" | "notify";
  ms: number;
};

/** About 4 words a second to read, never under 1.4 s. */
function readMs(text: string) {
  return Math.max(1400, 650 + text.split(/\s+/).length * 230);
}

/**
 * The call, beat by beat, from the copy the server chose. One loop runs about
 * 40 s: long enough to read every line, with a rest on the summary.
 */
function script(copy: ReceptionistCallCopy, booking: boolean, transfer: boolean): Beat[] {
  const { marks, lines } = copy;
  const beats: Beat[] = [
    { stage: "ring", line: -1, voice: "none", fields: 0, dock: "details", step: 0, phase: "call", ms: 2200 },
    { stage: "ring", line: -1, voice: "none", fields: 0, dock: "details", step: 1, phase: "call", ms: 900 },
  ];
  let fields = 0;
  let dock: Beat["dock"] = "details";
  let step = 0;
  lines.forEach((entry, index) => {
    if (index === marks.need) fields = 1;
    if (index === marks.urgency) fields = 2;
    if (index === marks.details) fields = copy.fields.length;
    if (index === marks.workStart) {
      dock = "work";
      step = 0;
    }
    if (index === marks.offer) step = 1;
    if (index === marks.pick) step = booking ? 2 : 1;
    if (index === marks.workEnd) step = booking ? 3 : 2;
    if (index === marks.handoff) {
      dock = "handoff";
      step = 0;
    }
    beats.push({
      stage: "talk",
      line: index,
      voice: entry.who,
      fields,
      dock,
      step,
      phase: index < marks.need ? "call" : "card",
      ms: readMs(entry.text),
    });
    // The calendar check is a short silence, as on a real call.
    if (booking && index === marks.workStart) {
      beats.push({ ...beats[beats.length - 1]!, voice: "none", ms: 1100 });
    }
  });
  const last = lines.length - 1;
  const base = { line: last, fields, dock: "handoff" as const, phase: "card" as const };
  if (transfer) {
    beats.push(
      { ...base, stage: "talk", voice: "hold", step: 1, ms: 1700 },
      { ...base, stage: "talk", voice: "brief", step: 2, ms: 1900 },
      { ...base, stage: "talk", voice: "caller", step: 3, ms: 2000 },
    );
  } else {
    beats.push({ ...base, stage: "talk", voice: "none", step: 1, ms: 1400 });
  }
  beats.push(
    { ...base, stage: "ended", voice: "none", step: transfer ? 3 : 1, ms: 1100 },
    { ...base, stage: "summary", voice: "none", step: transfer ? 3 : 1, phase: "notify", ms: 1300 },
    { ...base, stage: "summary", voice: "none", step: transfer ? 3 : 1, phase: "notify", ms: 5200 },
  );
  return beats;
}

/** Waveform bars: a resting height and a speed, uneven so they never march in step. */
const BARS = [
  [0.45, 0.92], [0.7, 1.18], [0.55, 0.81], [0.9, 1.07], [0.6, 0.73],
  [1, 1.24], [0.75, 0.88], [0.5, 1.02], [0.85, 0.77], [0.65, 1.15],
  [0.95, 0.84], [0.55, 0.96], [0.8, 1.21], [0.6, 0.79], [0.9, 1.09],
  [0.5, 0.87], [0.7, 1.13], [0.45, 0.8], [0.6, 0.99], [0.4, 1.17],
  [0.75, 0.9], [0.55, 1.05],
] as const;

/** The list's bottom padding (pb-1.5), kept under the newest line. */
const LIST_PAD = 6;

const NOTICE =
  "tc-wf-notice absolute z-10 hidden items-center gap-2.5 rounded-[var(--radius-md)] border border-[rgb(var(--ink-rgb)/0.12)] bg-surface py-2 pr-3.5 pl-2.5 shadow-[0_18px_36px_-20px_rgb(var(--ink-rgb)/0.42)] sm:flex";

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * One call answered by the receptionist, from the first ring to the summary
 * on the contractor's dashboard: the caller explains the job, the details are
 * captured as they are said, the calendar is checked and a time booked (or,
 * before scheduling is verified, the request goes to the team), the caller asks
 * for the owner, and the call ends in a summary.
 *
 * Like the phone it replaces, the server renders the finished state (the
 * summary), so the page is complete without JavaScript and for anyone who asks
 * for reduced motion. Where motion is welcome the beats loop, only opacity and
 * transforms change, and playback holds off screen, in a background tab, or
 * when the visitor pauses it. It keeps the `.tc-wf` contract (data-wf-live,
 * data-wf-hold, data-wf-phase, data-wf-beat) so the hero copy and the no-script
 * fallback in globals.css work unchanged.
 */
export function ReceptionistCallPhone({
  copy,
  booking,
  transfer,
}: {
  copy: ReceptionistCallCopy;
  /** The scheduling flag: true checks the calendar and books a time. */
  booking: boolean;
  /** The live-transfer flag: true connects the caller to the owner. */
  transfer: boolean;
}) {
  const beats = useMemo(() => script(copy, booking, transfer), [copy, booking, transfer]);
  const FINAL = beats.length - 1;
  /** Call length shown at the end: the beats from the answer to the hang-up. */
  const total = useMemo(() => {
    const end = beats.findIndex((b) => b.stage === "ended");
    return Math.round(beats.slice(2, end).reduce((sum, b) => sum + b.ms, 0) / 1000);
  }, [beats]);

  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [step, setStep] = useState(FINAL);
  const [live, setLive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [seconds, setSeconds] = useState(0);

  // Start only where motion is welcome, and follow the preference if it changes.
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: no-preference)");
    const apply = () => {
      if (motion.matches) {
        setLive(true);
        setStep(0);
        setPlaying(true);
      } else {
        setLive(false);
        setPlaying(false);
        setStep(FINAL);
      }
    };
    apply();
    motion.addEventListener("change", apply);
    return () => motion.removeEventListener("change", apply);
  }, [FINAL]);

  useEffect(() => {
    const node = root.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const running = live && playing && inView && pageVisible;
  const beat = beats[step]!;

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      const next = step < FINAL ? step + 1 : 0;
      if (next === 0) setSeconds(0);
      setStep(next);
    }, beat.ms);
    return () => window.clearTimeout(timer);
  }, [running, step, beat.ms, FINAL]);

  // The call timer runs from the answer to the hang-up, in real seconds.
  const onCall = beat.stage === "talk";
  useEffect(() => {
    if (!running || !onCall) return;
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running, onCall]);
  const shownSeconds = live && beat.stage === "talk" ? seconds : total;

  // Slide the transcript so the newest line sits on the card below it. Written
  // to the element directly: a transform only, no re-render, no layout change.
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    if (!live) {
      node.style.transform = "";
      return;
    }
    const place = () => {
      const slot =
        beat.line >= 0
          ? node.querySelector<HTMLElement>(`[data-rc-line="${beat.line}"]`)
          : null;
      const bottom = slot ? slot.offsetTop + slot.offsetHeight : 0;
      const shift = Math.max(0, node.offsetHeight - LIST_PAD - bottom);
      node.style.transform = `translateY(${shift}px)`;
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(node);
    return () => observer.disconnect();
  }, [live, beat.line]);

  const talking = (who: "agent" | "caller") =>
    !live || beat.stage !== "talk"
      ? "off"
      : beat.voice === who || (who === "agent" && beat.voice === "brief")
        ? "1"
        : "0";
  const onHold = beat.voice === "hold" || beat.voice === "brief";
  const connected = transfer && beat.dock === "handoff" && beat.step >= 3;
  const ended = beat.stage === "ended" || beat.stage === "summary";

  return (
    <div
      ref={root}
      className="tc-wf tc-rc relative mx-auto flex w-full max-w-[476px] flex-col items-center"
      data-wf-live={live ? "" : undefined}
      data-wf-step={step}
      // Coarse chapter of the story, for the hero copy beside the phone.
      data-wf-phase={beat.phase}
      data-wf-hold={live && !running ? "" : undefined}
    >
      <p className="sr-only">{copy.summaryText}</p>
      <div className="relative flex w-full justify-center [--wf-phone:min(100%,304px)] sm:py-3 sm:[--wf-phone:320px] lg:[--wf-phone:336px]">
        {/* Phone body: navy shell, side keys, glass screen. */}
        <div data-motion="phone" className="relative w-[var(--wf-phone)] shrink-0">
          <span aria-hidden className="absolute top-[118px] -left-[3px] h-9 w-[3px] rounded-l-sm bg-navy-light" />
          <span aria-hidden className="absolute top-[166px] -left-[3px] h-14 w-[3px] rounded-l-sm bg-navy-light" />
          <span aria-hidden className="absolute top-[150px] -right-[3px] h-20 w-[3px] rounded-r-sm bg-navy-light" />

          <div className="rounded-[48px] bg-[linear-gradient(150deg,#2a3746_0%,var(--color-navy)_38%,#05090e_100%)] p-[9px] shadow-[0_44px_70px_-34px_rgb(var(--ink-rgb)/0.62),0_14px_28px_-18px_rgb(var(--ink-rgb)/0.4),inset_0_0_0_1px_rgb(255_255_255/0.08)]">
            <div
              role="group"
              aria-label={copy.screenLabel}
              className="relative isolate flex aspect-[9/19] flex-col overflow-hidden rounded-[39px] bg-[radial-gradient(130%_80%_at_50%_0%,#1d2b3a_0%,var(--color-navy)_52%,#070c12_100%)] text-white sm:aspect-[9/17.4]"
            >
              <StatusBar dark={beat.stage !== "summary"} />

              {/* 1. The call rings, and the receptionist picks up. */}
              <Beat
                on={beat.stage === "ring"}
                className="tc-wf-call tc-wf-first absolute inset-0 z-20 flex flex-col bg-[radial-gradient(120%_70%_at_50%_0%,#1d2b3a_0%,var(--color-navy)_55%,#070c12_100%)] px-4 pt-[58px] pb-7"
              >
                <p className="m-0 text-center text-[12.5px] text-white/70">{copy.incoming}</p>
                <div className="relative mx-auto mt-5 flex h-[92px] w-[92px] items-center justify-center">
                  <span
                    aria-hidden
                    className={cn("tc-wf-ring absolute inset-0 rounded-full border border-orange/60", beat.stage === "ring" && beat.step === 0 && "is-ringing")}
                  />
                  <span
                    aria-hidden
                    className={cn("tc-wf-ring tc-wf-ring-late absolute inset-0 rounded-full border border-orange/40", beat.stage === "ring" && beat.step === 0 && "is-ringing")}
                  />
                  <span aria-hidden className="relative flex h-[76px] w-[76px] items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15">
                    <UserRound className="h-9 w-9 text-white/85" strokeWidth={1.6} />
                  </span>
                </div>
                <p className="m-0 mt-4 text-center leading-tight">
                  <span className="block text-[20px] font-extrabold tracking-[-0.02em]">{copy.caller}</span>
                  <span className="mt-1.5 block text-[13px] text-white/70">{copy.callerLine}</span>
                </p>
                <p className="m-0 mt-3 flex justify-center">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[12px] font-medium text-white/85 ring-1 ring-white/10">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-orange" />
                    {copy.line}
                  </span>
                </p>

                <div className="relative mt-auto h-[92px]">
                  <Beat
                    on={beat.stage === "ring" && beat.step === 0}
                    className="tc-wf-fade tc-wf-first absolute inset-x-0 bottom-0 flex flex-col items-center gap-2.5"
                  >
                    <span aria-hidden className="tc-wf-answer flex h-14 w-14 items-center justify-center rounded-full bg-green text-navy">
                      <Phone className="h-6 w-6" strokeWidth={2} />
                    </span>
                    <span className="text-[12.5px] font-semibold text-white/85">{copy.answering}</span>
                  </Beat>
                  <Beat
                    on={beat.stage === "ring" && beat.step === 1}
                    className="tc-wf-pop absolute inset-x-0 bottom-4 flex justify-center"
                  >
                    <span className="inline-flex items-center gap-2 rounded-full bg-orange px-4 py-2.5 text-[13px] font-bold text-navy shadow-[0_14px_30px_-14px_rgb(228_118_43/0.8)]">
                      <PhoneCall aria-hidden className="h-4 w-4" strokeWidth={2.4} />
                      {copy.answered}
                    </span>
                  </Beat>
                </div>
              </Beat>

              {/* 2. The live call: who is speaking, what was said, what is captured. */}
              <div className="flex min-h-0 flex-1 flex-col px-3 pb-6">
                <div className="flex items-center gap-2.5 rounded-[18px] bg-white/[0.06] px-2.5 py-2 ring-1 ring-white/[0.06]">
                  <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
                    <UserRound className="h-[18px] w-[18px] text-white/85" strokeWidth={1.9} />
                  </span>
                  <p className="m-0 min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[13.5px] font-bold">{copy.caller}</span>
                    <span className="flex items-center gap-1.5 text-[11.5px] text-white/65">
                      <span
                        aria-hidden
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-300",
                          connected ? "bg-[#4ade80]" : ended ? "bg-[#ff9b8f]" : onHold ? "bg-orange" : "bg-[#4ade80]",
                        )}
                      />
                      <span className="truncate">
                        {/* After a transfer the caller stays on with the owner. */}
                        {connected ? copy.handoff.title[1] : ended ? copy.callEnded : onHold ? copy.onHold : copy.onCall}
                      </span>
                      <span aria-hidden className="ml-auto shrink-0 tabular-nums">{clock(shownSeconds)}</span>
                    </span>
                  </p>
                </div>

                {/* Both voices, always moving: the one speaking rises. */}
                <div aria-hidden className="mt-2 space-y-1 rounded-[16px] bg-white/[0.04] px-2.5 py-1.5">
                  <Lane label={copy.speakerAgent} voice={talking("agent")} tone="agent" />
                  <Lane label={copy.speakerCaller} voice={talking("caller")} tone="caller" note={onHold ? copy.onHold : undefined} />
                </div>

                {/* The transcript, newest line at the bottom. */}
                <div className="relative mt-1.5 min-h-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,#000_26px)]">
                  <ol
                    ref={list}
                    className="tc-rc-list absolute inset-x-0 bottom-0 m-0 flex list-none flex-col gap-1.5 px-0.5 pt-3 pb-1.5"
                  >
                    {copy.lines.map((entry, index) => (
                      <Line
                        key={index}
                        index={index}
                        who={entry.who}
                        label={entry.who === "agent" ? copy.speakerAgent : copy.speakerCaller}
                        text={entry.text}
                        on={index <= beat.line}
                        ms={readMs(entry.text)}
                      />
                    ))}
                  </ol>
                </div>

                {/* What the receptionist is doing with it. Cards share one place. */}
                <div aria-hidden className="relative mt-1.5 h-[118px] shrink-0">
                  <Beat on={beat.dock === "details"} className="tc-wf-fade absolute inset-0">
                    <DetailsCard copy={copy} count={beat.fields} />
                  </Beat>
                  <Beat on={beat.dock === "work"} className="tc-wf-fade absolute inset-0">
                    <WorkCard copy={copy} booking={booking} step={beat.dock === "work" ? beat.step : booking ? 3 : 2} spin={running} />
                  </Beat>
                  <Beat on={beat.dock === "handoff"} className="tc-wf-fade absolute inset-0">
                    <HandoffCard copy={copy} transfer={transfer} step={beat.step} spin={running} />
                  </Beat>
                </div>
              </div>

              {/* 3. The summary on the contractor's dashboard. */}
              <Beat
                on={beat.stage === "summary"}
                className="tc-wf-fade absolute inset-0 z-30 flex flex-col bg-paper px-3 pt-[50px] pb-6 text-heading"
              >
                <div className="flex items-center gap-2 px-1">
                  <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-navy text-orange">
                    <LayoutDashboard className="h-3.5 w-3.5" strokeWidth={2.3} />
                  </span>
                  <span className="text-[15px] font-extrabold tracking-[-0.01em]">{copy.appTitle}</span>
                  <span className="ml-auto text-[11.5px] font-medium text-muted">{copy.appToday}</span>
                </div>

                {/* Room for the notification, which lands above the card. */}
                <div className="mt-[104px] rounded-[18px] border border-[rgb(var(--ink-rgb)/0.1)] bg-surface p-3 shadow-[0_14px_28px_-20px_rgb(var(--ink-rgb)/0.45)]">
                  <div className="flex items-center gap-2.5">
                    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-orange">
                      <PhoneIncoming className="h-4 w-4" strokeWidth={2.2} />
                    </span>
                    <p className="m-0 min-w-0 flex-1 leading-tight">
                      <span className="block text-[13.5px] font-extrabold">{copy.summaryTitle}</span>
                      <span className="block truncate text-[11px] text-muted">{copy.summaryBy}</span>
                    </p>
                    <span className="shrink-0 rounded-full bg-paper-deep px-2 py-0.5 text-[11px] font-semibold tabular-nums text-secondary">
                      {clock(total)}
                    </span>
                  </div>
                  <dl className="m-0 mt-2.5 space-y-1.5 border-t border-[rgb(var(--ink-rgb)/0.08)] pt-2.5">
                    {copy.rows.map(([label, value], index) => (
                      <div key={label} className="grid grid-cols-[74px_minmax(0,1fr)] items-baseline gap-2">
                        <dt className="text-[11px] text-muted">{label}</dt>
                        <dd
                          className={cn(
                            "m-0 text-[12px] leading-snug font-semibold",
                            index === copy.outcomeRow ? "text-signal-text" : "text-heading",
                          )}
                        >
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <ul className="m-0 mt-2.5 flex list-none flex-wrap gap-1.5 p-0">
                    {copy.chips.map((chip, index) => (
                      <li
                        key={chip}
                        className="inline-flex items-center gap-1 rounded-full border border-[rgb(var(--ink-rgb)/0.12)] bg-paper px-2 py-0.5 text-[10.5px] font-medium text-secondary"
                      >
                        {index === 0 ? (
                          <FileText aria-hidden className="h-3 w-3 text-ember-text" strokeWidth={2.2} />
                        ) : (
                          <MessageSquareText aria-hidden className="h-3 w-3 text-ember-text" strokeWidth={2.2} />
                        )}
                        {chip}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-2 flex items-center gap-2.5 rounded-[14px] border border-[rgb(var(--ink-rgb)/0.08)] bg-surface/70 px-3 py-2 opacity-70">
                  <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-paper-deep text-secondary">
                    <Phone className="h-3 w-3" strokeWidth={2.2} />
                  </span>
                  <p className="m-0 min-w-0 flex-1 truncate text-[11.5px] font-semibold text-secondary">{copy.earlier[0]}</p>
                  <span className="shrink-0 text-[10.5px] text-muted">{copy.earlier[1]}</span>
                </div>
              </Beat>

              {/* The contractor's alert, dropped in from the top. */}
              <Beat on={beat.stage === "summary"} className="tc-wf-drop absolute inset-x-2.5 top-[86px] z-40">
                <div className="flex items-start gap-2.5 rounded-[18px] border border-[rgb(var(--ink-rgb)/0.08)] bg-surface/95 p-2.5 text-heading shadow-[0_18px_32px_-18px_rgb(var(--ink-rgb)/0.55)] backdrop-blur-sm">
                  <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-navy text-orange">
                    <Check className="h-5 w-5" strokeWidth={3} />
                  </span>
                  <p className="m-0 min-w-0 flex-1 leading-tight">
                    <span className="flex items-center justify-between gap-2 text-[11px] text-muted">
                      <span className="font-semibold tracking-[0.02em] uppercase">{copy.notifyApp}</span>
                      <span>{copy.notifyNow}</span>
                    </span>
                    <span className="mt-0.5 block text-[13px] font-bold">{copy.notifyTitle}</span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-secondary">{copy.notifyBody}</span>
                  </p>
                </div>
              </Beat>

              {/* Glass sheen and home indicator. */}
              <span aria-hidden className="pointer-events-none absolute inset-0 z-50 rounded-[39px] bg-[linear-gradient(115deg,rgb(255_255_255/0.14)_0%,rgb(255_255_255/0)_32%)]" />
              <span
                aria-hidden
                className={cn(
                  "absolute bottom-2 left-1/2 z-50 h-[5px] w-28 -translate-x-1/2 rounded-full transition-colors duration-500",
                  beat.stage === "summary" ? "bg-navy/80" : "bg-white/70",
                )}
              />
            </div>
          </div>
        </div>

        {/* Floating notices. They repeat the screen, so they are decoration,
            and they sit over its status bar and home bar, never its text. */}
        <Beat
          aria-hidden
          on={step >= 1}
          className={cn(NOTICE, "tc-wf-rise top-[20px] left-[max(0px,calc(50%-var(--wf-phone)/2-40px))]")}
        >
          <PhoneCall className="h-4 w-4 text-ember-text" strokeWidth={2.2} />
          <span className="max-w-[112px] text-[12.5px] leading-tight font-bold text-heading">{copy.noticeLeft}</span>
        </Beat>
        <Beat
          aria-hidden
          on={beat.stage === "summary"}
          className={cn(NOTICE, "tc-wf-rise right-[max(0px,calc(50%-var(--wf-phone)/2-40px))] bottom-0")}
        >
          <LayoutDashboard className="h-4 w-4 text-signal-text" strokeWidth={2.1} />
          <span className="max-w-[112px] text-[12.5px] leading-tight font-bold text-heading">{copy.noticeRight}</span>
        </Beat>
      </div>

      {/* A control is only offered where something moves (WCAG 2.2.2). */}
      <div className="mt-3 flex h-9 items-center justify-center">
        {live ? (
          <button
            type="button"
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? copy.pause : copy.play}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[rgb(var(--ink-rgb)/0.16)] bg-surface px-3.5 text-[13px] font-semibold text-secondary transition-colors hover:border-navy hover:text-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
          >
            {playing ? (
              <Pause aria-hidden className="h-3.5 w-3.5" strokeWidth={2.2} />
            ) : (
              <Play aria-hidden className="h-3.5 w-3.5" strokeWidth={2.2} />
            )}
            <span aria-hidden>{playing ? copy.pause : copy.play}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One speaker's waveform. "1": speaking, "0": listening (a low breath, so both
 * voices are always alive), "off": not on a call, so nothing animates unseen.
 */
function Lane({
  label,
  voice,
  tone,
  note,
}: {
  label: string;
  voice: "1" | "0" | "off";
  tone: "agent" | "caller";
  note?: string;
}) {
  return (
    <div className="flex h-[22px] items-center gap-2">
      <span
        className={cn(
          "w-[86px] shrink-0 truncate text-[10.5px] font-semibold transition-colors duration-300",
          voice === "1" ? "text-white" : "text-white/50",
        )}
      >
        <span
          className={cn(
            "mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle",
            tone === "agent" ? "bg-orange" : "bg-[#9cc7ff]",
          )}
        />
        {note ?? label}
      </span>
      <span data-voice={voice} className="tc-voice flex h-full min-w-0 flex-1 items-center justify-between">
        {BARS.map(([height, speed], index) => (
          <span
            key={index}
            className={cn(
              "tc-voice-bar block w-[2.5px] origin-center rounded-full",
              tone === "agent" ? "bg-orange" : "bg-[#9cc7ff]",
            )}
            style={{
              height: `${Math.round(height * 100)}%`,
              animationDuration: `${speed}s`,
              animationDelay: `${-((index * 0.137) % speed)}s`,
            }}
          />
        ))}
      </span>
    </div>
  );
}

/**
 * A transcript line. The words of the line being spoken appear one after the
 * other (CSS, from --rc-i and --rc-word); screen readers get the whole line.
 */
function Line({
  index,
  who,
  label,
  text,
  on,
  ms,
}: {
  index: number;
  who: "agent" | "caller";
  label: string;
  text: string;
  on: boolean;
  ms: number;
}) {
  const words = text.split(/\s+/);
  const agent = who === "agent";
  const perWord = Math.round(Math.min(130, (ms * 0.5) / words.length));
  return (
    <li
      data-rc-line={index}
      data-wf-beat
      data-on={on ? "true" : "false"}
      className={cn("tc-wf-rise tc-rc-line flex flex-col", agent ? "items-start" : "items-end")}
      style={{ "--rc-word": `${perWord}ms` } as CSSProperties}
    >
      <span
        className={cn(
          "mb-0.5 inline-flex items-center gap-1 px-1 text-[10px] font-semibold",
          agent ? "text-orange" : "text-[#9cc7ff]",
        )}
      >
        {label}
      </span>
      <p
        className={cn(
          "m-0 max-w-[90%] rounded-[15px] px-2.5 py-1.5 text-[12px] leading-[1.38]",
          agent ? "rounded-tl-[5px] bg-white/[0.1] text-white" : "rounded-tr-[5px] bg-[#9cc7ff]/15 text-white",
        )}
      >
        <span className="sr-only">{text}</span>
        <span aria-hidden>
          {words.map((word, i) => (
            <span key={i} className="tc-rc-word" style={{ "--rc-i": i } as CSSProperties}>
              {word}
              {i < words.length - 1 ? " " : ""}
            </span>
          ))}
        </span>
      </p>
    </li>
  );
}

const CARD =
  "flex h-full flex-col rounded-[16px] bg-surface px-3 py-2.5 text-heading shadow-[0_12px_24px_-16px_rgb(0_0_0/0.6)]";

function Tick({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full transition-colors duration-300",
        on ? "bg-signal-text text-white" : "border border-[rgb(var(--ink-rgb)/0.2)]",
      )}
    >
      {on ? <Check className="h-2.5 w-2.5" strokeWidth={3.2} /> : null}
    </span>
  );
}

/** The details the receptionist asks for, ticked off as the caller gives them. */
function DetailsCard({ copy, count }: { copy: ReceptionistCallCopy; count: number }) {
  return (
    <div className={CARD}>
      <p className="m-0 flex items-center gap-1.5 text-[11.5px] font-bold">
        <ClipboardList className="h-3.5 w-3.5 text-ember-text" strokeWidth={2.2} />
        {copy.detailsTitle}
        <span className="ml-auto text-[10.5px] font-semibold tabular-nums text-muted">
          {count}/{copy.fields.length}
        </span>
      </p>
      <ul className="m-0 mt-1.5 list-none space-y-[3px] p-0">
        {copy.fields.map(([label, value], index) => {
          const ok = index < count;
          return (
            <li key={label} className="flex items-center gap-2 text-[10.5px] leading-[14px]">
              <Tick on={ok} />
              <span className="w-[62px] shrink-0 truncate text-muted">{label}</span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-semibold transition-opacity duration-300",
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
  );
}

/**
 * Booking: the calendar is checked, the open times found, the caller's pick
 * marked and booked. Request (scheduling not verified): the request is made
 * up for the team, which confirms the time.
 */
function WorkCard({
  copy,
  booking,
  step,
  spin,
}: {
  copy: ReceptionistCallCopy;
  booking: boolean;
  step: number;
  spin: boolean;
}) {
  const done = booking ? step >= 3 : step >= 2;
  return (
    <div className={CARD}>
      <p className="m-0 flex items-center gap-1.5 text-[11.5px] font-bold">
        {done ? (
          <Check className="h-3.5 w-3.5 text-signal-text" strokeWidth={2.8} />
        ) : step === 0 ? (
          <LoaderCircle className={cn("h-3.5 w-3.5 text-ember-text", spin && "tc-wf-spin")} strokeWidth={2.2} />
        ) : booking ? (
          <CalendarCheck className="h-3.5 w-3.5 text-ember-text" strokeWidth={2.2} />
        ) : (
          <ClipboardList className="h-3.5 w-3.5 text-ember-text" strokeWidth={2.2} />
        )}
        <span className={cn("truncate", done && "text-signal-text")}>
          {copy.work.title[Math.min(step, 3)]}
        </span>
      </p>
      {booking ? (
        <ul className="m-0 mt-2 grid list-none grid-cols-3 gap-1.5 p-0">
          {copy.work.items.map((slot, index) => {
            const busy = index === 0;
            const shown = step >= 1;
            const picked = index === 1 && step >= 2;
            return (
              <li
                key={slot}
                className={cn(
                  "rounded-[10px] border px-1 py-1.5 text-center text-[10px] leading-tight font-semibold transition-[background-color,border-color,color,opacity] duration-500",
                  !shown && "border-[rgb(var(--ink-rgb)/0.1)] text-transparent",
                  shown && busy && "border-[rgb(var(--ink-rgb)/0.1)] bg-paper-deep/60 text-muted line-through",
                  shown && !busy && !picked && "border-[rgb(var(--ink-rgb)/0.18)] text-heading",
                  picked && "border-signal-text bg-signal-text text-white",
                )}
              >
                {slot}
                <span className="block text-[9px] font-medium no-underline">
                  {busy ? copy.work.busy : picked ? <Check className="mx-auto h-2.5 w-2.5" strokeWidth={3.2} /> : " "}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="m-0 mt-1.5 list-none space-y-[3px] p-0">
          {copy.work.items.map((item, index) => (
            <li key={item} className="flex items-center gap-2 text-[10.5px] leading-[14px]">
              <Tick on={step >= index} />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-semibold transition-opacity duration-300",
                  step >= index ? "opacity-100" : "opacity-35",
                )}
              >
                {item}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The caller asks for a person. With live transfer switched on: the owner's
 * phone rings while the caller holds, the receptionist briefs whoever answers,
 * and the call is connected once they accept. Otherwise: a callback request,
 * flagged for the owner.
 */
function HandoffCard({
  copy,
  transfer,
  step,
  spin,
}: {
  copy: ReceptionistCallCopy;
  transfer: boolean;
  step: number;
  spin: boolean;
}) {
  const done = transfer ? step >= 3 : step >= 1;
  const Icon = transfer ? PhoneForwarded : PhoneCall;
  return (
    <div className={CARD}>
      <p className="m-0 flex items-center gap-1.5 text-[11.5px] font-bold">
        {done ? (
          <Check className="h-3.5 w-3.5 text-signal-text" strokeWidth={2.8} />
        ) : transfer && step > 0 ? (
          <LoaderCircle className={cn("h-3.5 w-3.5 text-ember-text", spin && "tc-wf-spin")} strokeWidth={2.2} />
        ) : (
          <Icon className="h-3.5 w-3.5 text-ember-text" strokeWidth={2.2} />
        )}
        <span className={cn("truncate", done && "text-signal-text")}>
          {done ? copy.handoff.title[1] : copy.handoff.title[0]}
        </span>
      </p>
      <ul className="m-0 mt-1.5 list-none space-y-[3px] p-0">
        {copy.handoff.rows.map((row, index) => {
          // Transfer: one row per stage (ringing at step 1, briefing at 2,
          // connected at 3), each ticked once the next begins.
          // Callback: the first two are known at once, the last when flagged.
          const ok = transfer ? step >= 3 || step > index + 1 : index < 2 || step >= 1;
          const active = transfer && step === index + 1 && !ok;
          return (
            <li key={row} className="flex items-center gap-2 text-[10.5px] leading-[14px]">
              <Tick on={ok} />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-semibold transition-opacity duration-300",
                  ok || active ? "opacity-100" : "opacity-35",
                )}
              >
                {row}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Something that enters at its beat. Hidden beats keep their space, so nothing
 * on the screen reflows while the call plays, and they stay in the
 * accessibility tree, so a screen reader always gets the whole story.
 */
function Beat({
  on,
  className,
  children,
  "aria-hidden": ariaHidden,
}: {
  on: boolean;
  className?: string;
  children: ReactNode;
  "aria-hidden"?: boolean;
}) {
  return (
    <div data-wf-beat data-on={on ? "true" : "false"} aria-hidden={ariaHidden} className={className}>
      {children}
    </div>
  );
}

function StatusBar({ dark }: { dark: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative z-50 flex h-[46px] shrink-0 items-center justify-between px-7 pt-1 text-[13px] font-semibold transition-colors duration-500",
        dark ? "text-white" : "text-heading",
      )}
    >
      <span>9:41</span>
      <span className="absolute top-[11px] left-1/2 h-[25px] w-[92px] -translate-x-1/2 rounded-full bg-[#05090e]" />
      <span className="flex items-center gap-1">
        <Signal className="h-3.5 w-3.5" strokeWidth={2.4} />
        <Wifi className="h-3.5 w-3.5" strokeWidth={2.4} />
        <BatteryFull className="h-4 w-4" strokeWidth={2} />
      </span>
    </div>
  );
}
