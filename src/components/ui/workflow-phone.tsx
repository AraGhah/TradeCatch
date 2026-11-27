"use client";

import {
  BatteryFull,
  CalendarCheck,
  Check,
  ChevronLeft,
  ClipboardList,
  HardHat,
  LoaderCircle,
  Pause,
  Phone,
  PhoneMissed,
  PhoneOff,
  Play,
  SendHorizontal,
  Signal,
  UserRound,
  Wifi,
  Zap,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

/**
 * Every line the phone shows, already translated and already chosen for the
 * scheduling flag by the server parent, so this file never decides what the
 * product promises.
 */
export type WorkflowPhoneCopy = {
  screenLabel: string;
  busy: string;
  incoming: string;
  line: string;
  customer: string;
  service: string;
  decline: string;
  answer: string;
  missed: string;
  textingBack: string;
  auto: string;
  sms1: string;
  sms2: string;
  sms3: string;
  sms4: string;
  sms5: string;
  sms6: string;
  sms7: string;
  cardTitle: string;
  cardWorking: string;
  /** Between the check and the confirmation (booked: the open times found). */
  cardFound: string;
  cardDone: string;
  /** Booked: the three calendar slots. Request: the collected details. */
  chips: [string, string, string];
  slotBusy: string;
  notifyApp: string;
  notifyNow: string;
  notifyTitle: string;
  notifyBody: string;
  resultFrom: string;
  resultTo: string;
  resultNote: string;
  composer: string;
  noticeLeft: string;
  noticeRight: string;
  pause: string;
  play: string;
};

/*
 * The workflow, beat by beat. DURATIONS is how long each beat holds, in ms:
 * about 1 s per 8 words of a new message, a short beat for typing, and a
 * longer rest on the result. One loop runs about 23 s.
 */
const B = {
  ringing: 0,
  missed: 1,
  typing1: 2,
  sms1: 3,
  typing2: 4,
  sms2: 5,
  typing3: 6,
  sms3: 7,
  typing4: 8,
  sms4: 9,
  checking: 10,
  offer: 11,
  pick: 12,
  confirm: 13,
  notify: 14,
  result: 15,
} as const;
const DURATIONS = [
  2000, 1400, 500, 1800, 700, 1700, 500, 1500, 600, 1300, 1300, 2000, 1000,
  1800, 2200, 3000,
];
const FINAL = B.result;

/**
 * The thread is anchored to the bottom like a real chat: for each beat, the
 * slot whose bottom edge sits on the message box (and, while someone types,
 * only its typing dots). Later slots wait below, out of sight, and the list
 * slides up as each one arrives. null: the bottom of the whole list.
 */
const ANCHORS: ({ slot: string; typing?: boolean } | null | "lift")[] = [
  { slot: "missed" },
  { slot: "missed" },
  { slot: "sms1", typing: true },
  { slot: "sms1" },
  { slot: "sms2", typing: true },
  { slot: "sms2" },
  { slot: "sms3", typing: true },
  { slot: "sms3" },
  { slot: "sms4", typing: true },
  { slot: "sms4" },
  { slot: "card" },
  { slot: "sms5" },
  { slot: "sms6" },
  null,
  null,
  "lift",
];
/**
 * On the result beat the thread rises clear of the result card: by the card's
 * measured height when the player runs, by this much (globals.css) when not.
 */
const RESULT_LIFT = 26;
/** The result card's distance from the bottom of the screen (bottom-[18px]). */
const RESULT_BOTTOM = 18;
const RESULT_GAP = 8;
/** The list's bottom padding (pb-2), kept under the anchored slot. */
const LIST_PAD = 8;

const NOTICE =
  "tc-wf-notice absolute z-10 hidden items-center gap-2.5 rounded-[var(--radius-md)] border border-[rgb(var(--ink-rgb)/0.12)] bg-surface py-2 pr-3.5 pl-2.5 shadow-[0_18px_36px_-20px_rgb(var(--ink-rgb)/0.42)] sm:flex";

/**
 * One missed call followed to a result on the contractor's phone: it rings
 * while they are on a job, goes unanswered, TradeCatch texts the caller back
 * at once, the conversation collects the need, name and address, the calendar
 * is checked, the visit is confirmed, the contractor is notified, and the
 * missed call ends as a booked job (or, before scheduling is verified, as a
 * job request the owner confirms).
 *
 * The server renders the finished state, so the page is complete without
 * JavaScript and for anyone who asks for reduced motion. Where motion is
 * welcome the beats loop, only opacity and transforms change, and playback
 * holds off screen, in a background tab, or when the visitor pauses it.
 */
export function WorkflowPhone({
  copy,
  booked,
}: {
  copy: WorkflowPhoneCopy;
  /** The scheduling flag: true shows calendar slots and a confirmed booking. */
  booked: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [step, setStep] = useState<number>(FINAL);
  const [live, setLive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

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
  }, []);

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

  useEffect(() => {
    if (!live || !playing || !inView || !pageVisible) return;
    const timer = window.setTimeout(
      () => setStep(step < FINAL ? step + 1 : 0),
      DURATIONS[step],
    );
    return () => window.clearTimeout(timer);
  }, [live, playing, inView, pageVisible, step]);

  // Slide the thread so the newest slot sits on the message box. Written to
  // the element directly: a transform only, no re-render, no layout change.
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    if (!live) {
      node.style.transform = "";
      return;
    }
    const place = () => {
      const entry = ANCHORS[step];
      const anchor = typeof entry === "object" ? entry : null;
      const slot = anchor
        ? node.querySelector<HTMLElement>(`[data-wf-slot="${anchor.slot}"]`)
        : null;
      let bottom = node.offsetHeight - LIST_PAD;
      if (slot) {
        const typing = anchor?.typing
          ? slot.querySelector<HTMLElement>("[data-wf-typing]")
          : null;
        bottom = slot.offsetTop + (typing ?? slot).offsetHeight;
      }
      let shift = Math.max(0, node.offsetHeight - LIST_PAD - bottom);
      if (entry === "lift") {
        const result =
          root.current?.querySelector<HTMLElement>("[data-wf-result]");
        const composer =
          root.current?.querySelector<HTMLElement>("[data-wf-composer]");
        shift =
          result && composer
            ? -Math.max(
                0,
                RESULT_BOTTOM +
                  result.offsetHeight +
                  RESULT_GAP -
                  composer.offsetHeight -
                  LIST_PAD,
              )
            : -RESULT_LIFT;
      }
      node.style.transform = `translateY(${shift}px)`;
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(node);
    return () => observer.disconnect();
  }, [live, step]);

  const at = (beat: number) => step >= beat;
  const only = (beat: number) => step === beat;
  const onCall = step <= B.missed;

  return (
    <div
      ref={root}
      className="tc-wf relative mx-auto flex w-full max-w-[476px] flex-col items-center"
      data-wf-live={live ? "" : undefined}
      data-wf-step={step}
      // Coarse chapter of the story, for the hero copy beside the phone.
      data-wf-phase={
        step <= B.missed
          ? "call"
          : step < B.checking
            ? "text"
            : step < B.notify
              ? "card"
              : "notify"
      }
      data-wf-hold={
        live && (!playing || !inView || !pageVisible) ? "" : undefined
      }
    >
      <div className="relative flex w-full justify-center [--wf-phone:min(100%,304px)] sm:py-3 sm:[--wf-phone:320px] lg:[--wf-phone:336px]">
        {/* Phone body: navy shell, side keys, glass screen. */}
        <div
          data-motion="phone"
          className="relative w-[var(--wf-phone)] shrink-0"
        >
          <span
            aria-hidden
            className="absolute top-[118px] -left-[3px] h-9 w-[3px] rounded-l-sm bg-navy-light"
          />
          <span
            aria-hidden
            className="absolute top-[166px] -left-[3px] h-14 w-[3px] rounded-l-sm bg-navy-light"
          />
          <span
            aria-hidden
            className="absolute top-[150px] -right-[3px] h-20 w-[3px] rounded-r-sm bg-navy-light"
          />

          <div className="rounded-[48px] bg-[linear-gradient(150deg,#2a3746_0%,var(--color-navy)_38%,#05090e_100%)] p-[9px] shadow-[0_44px_70px_-34px_rgb(var(--ink-rgb)/0.62),0_14px_28px_-18px_rgb(var(--ink-rgb)/0.4),inset_0_0_0_1px_rgb(255_255_255/0.08)]">
            <div
              role="group"
              aria-label={copy.screenLabel}
              className="relative isolate flex aspect-[9/19] flex-col overflow-hidden rounded-[39px] bg-paper sm:aspect-[9/17.4]"
            >
              <StatusBar dark={onCall} />

              {/* The call, over everything while it rings and is missed. First in
                  reading order, as it is first in the story. */}
              <Beat
                on={onCall}
                className="tc-wf-call tc-wf-first absolute inset-0 z-20 flex flex-col bg-[radial-gradient(120%_70%_at_50%_0%,#1d2b3a_0%,var(--color-navy)_55%,#070c12_100%)] px-4 pt-[52px] pb-7 text-white"
              >
                <p className="m-0 flex justify-center">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-orange/15 px-3 py-1 text-[12px] font-semibold text-orange-dark ring-1 ring-orange/25">
                    <HardHat
                      aria-hidden
                      className="h-3.5 w-3.5"
                      strokeWidth={2.2}
                    />
                    {copy.busy}
                  </span>
                </p>

                <div className="relative mx-auto mt-5 flex h-[92px] w-[92px] items-center justify-center">
                  <span
                    aria-hidden
                    className={cn(
                      "tc-wf-ring absolute inset-0 rounded-full border border-orange/60",
                      only(B.ringing) && "is-ringing",
                    )}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "tc-wf-ring tc-wf-ring-late absolute inset-0 rounded-full border border-orange/40",
                      only(B.ringing) && "is-ringing",
                    )}
                  />
                  <span
                    aria-hidden
                    className="relative flex h-[76px] w-[76px] items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15"
                  >
                    <UserRound
                      className="h-9 w-9 text-white/85"
                      strokeWidth={1.6}
                    />
                  </span>
                </div>

                <p className="m-0 mt-4 text-center leading-tight">
                  <span className="block text-[20px] font-extrabold tracking-[-0.02em]">
                    {copy.customer}
                  </span>
                  <span className="relative mt-1.5 block h-5 text-[13px] text-white/75">
                    <Beat
                      as="span"
                      on={only(B.ringing)}
                      className="tc-wf-fade tc-wf-first absolute inset-x-0 top-0 block"
                    >
                      {copy.incoming}
                    </Beat>
                    <Beat
                      as="span"
                      on={only(B.missed)}
                      className="tc-wf-fade absolute inset-x-0 top-0 block font-semibold text-[#ff9b8f]"
                    >
                      {copy.missed}
                    </Beat>
                  </span>
                </p>
                <p className="m-0 mt-3 flex justify-center">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[12px] font-medium text-white/85 ring-1 ring-white/10">
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 rounded-full bg-orange"
                    />
                    {copy.line}
                  </span>
                </p>

                <div className="relative mt-4 min-h-0 flex-1">
                  {/* Ringing: nobody can pick up. */}
                  <Beat
                    on={only(B.ringing)}
                    aria-hidden
                    className="tc-wf-fade tc-wf-first absolute inset-x-0 bottom-1 flex justify-around"
                  >
                    <span className="flex flex-col items-center gap-1.5 text-[12px] text-white/80">
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#c2412d]">
                        <PhoneOff className="h-6 w-6" strokeWidth={2} />
                      </span>
                      {copy.decline}
                    </span>
                    <span className="flex flex-col items-center gap-1.5 text-[12px] text-white/80">
                      <span className="tc-wf-answer flex h-14 w-14 items-center justify-center rounded-full bg-green">
                        <Phone className="h-6 w-6" strokeWidth={2} />
                      </span>
                      {copy.answer}
                    </span>
                  </Beat>

                  {/* Missed: TradeCatch takes over. */}
                  <Beat
                    on={only(B.missed)}
                    className="tc-wf-pop absolute inset-x-0 bottom-4 flex justify-center"
                  >
                    <span className="inline-flex items-center gap-2 rounded-full bg-orange px-4 py-2.5 text-[13px] font-bold text-navy shadow-[0_14px_30px_-14px_rgb(228_118_43/0.8)]">
                      <Zap aria-hidden className="h-4 w-4" strokeWidth={2.4} />
                      {copy.textingBack}
                    </span>
                  </Beat>
                </div>
              </Beat>

              {/* The text conversation, as the contractor sees it in TradeCatch. */}
              <div className="flex items-center gap-2.5 border-b border-[rgb(var(--ink-rgb)/0.08)] bg-surface/85 px-3.5 pt-1 pb-2.5">
                <ChevronLeft
                  aria-hidden
                  className="h-5 w-5 shrink-0 text-ember-text"
                  strokeWidth={2.2}
                />
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-deep text-heading"
                >
                  <UserRound className="h-[18px] w-[18px]" strokeWidth={1.9} />
                </span>
                <p className="m-0 min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[14px] font-bold text-heading">
                    {copy.customer}
                  </span>
                  <span className="block truncate text-[12px] text-muted">
                    {copy.service}
                  </span>
                </p>
                <Phone
                  aria-hidden
                  className="h-[18px] w-[18px] shrink-0 text-ember-text"
                  strokeWidth={2}
                />
              </div>

              <div className="relative min-h-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,#000_22px)]">
                <ol
                  ref={list}
                  className="tc-wf-list absolute inset-x-0 bottom-0 m-0 flex list-none flex-col gap-2.5 px-3 pt-3 pb-2"
                >
                  <Beat
                    as="li"
                    on={at(B.missed)}
                    slot="missed"
                    className="tc-wf-rise flex justify-center"
                  >
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--ink-rgb)/0.1)] bg-surface px-3 py-1 text-[12px] font-semibold text-[#a3261b]">
                      <PhoneMissed
                        aria-hidden
                        className="h-3.5 w-3.5"
                        strokeWidth={2.3}
                      />
                      {copy.missed}
                      <span aria-hidden className="font-normal text-muted">
                        · 8:12
                      </span>
                    </span>
                  </Beat>

                  <Message
                    slot="sms1"
                    side="out"
                    on={at(B.sms1)}
                    typing={only(B.typing1)}
                    note={copy.auto}
                  >
                    {copy.sms1}
                  </Message>
                  <Message
                    slot="sms2"
                    side="in"
                    on={at(B.sms2)}
                    typing={only(B.typing2)}
                  >
                    {copy.sms2}
                  </Message>
                  <Message
                    slot="sms3"
                    side="out"
                    on={at(B.sms3)}
                    typing={only(B.typing3)}
                    note={copy.auto}
                  >
                    {copy.sms3}
                  </Message>
                  <Message
                    slot="sms4"
                    side="in"
                    on={at(B.sms4)}
                    typing={only(B.typing4)}
                  >
                    {copy.sms4}
                  </Message>

                  <Beat
                    as="li"
                    on={at(B.checking)}
                    slot="card"
                    className="tc-wf-pop"
                  >
                    <WorkCard
                      copy={copy}
                      booked={booked}
                      phase={
                        only(B.checking)
                          ? "working"
                          : at(B.confirm)
                            ? "done"
                            : "found"
                      }
                    />
                  </Beat>

                  <Message
                    slot="sms5"
                    side="out"
                    on={at(B.offer)}
                    note={copy.auto}
                  >
                    {copy.sms5}
                  </Message>
                  <Message slot="sms6" side="in" on={at(B.pick)}>
                    {copy.sms6}
                  </Message>
                  <Message
                    slot="sms7"
                    side="out"
                    on={at(B.confirm)}
                    note={copy.auto}
                  >
                    {copy.sms7}
                  </Message>
                </ol>
              </div>

              <div
                aria-hidden
                data-wf-composer
                className="flex items-center gap-2 px-3 pt-1 pb-6"
              >
                <span className="flex h-9 min-w-0 flex-1 items-center rounded-full border border-[rgb(var(--ink-rgb)/0.14)] bg-surface px-3.5 text-[12.5px] text-muted">
                  <span className="truncate">{copy.composer}</span>
                </span>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange text-navy">
                  <SendHorizontal className="h-4 w-4" strokeWidth={2.2} />
                </span>
              </div>

              {/* The contractor's alert, dropped in from the top. */}
              <Beat
                on={at(B.notify)}
                className="tc-wf-drop absolute inset-x-2.5 top-[48px] z-40"
              >
                <div className="flex items-start gap-2.5 rounded-[18px] border border-[rgb(var(--ink-rgb)/0.08)] bg-surface/95 p-2.5 shadow-[0_18px_32px_-18px_rgb(var(--ink-rgb)/0.55)] backdrop-blur-sm">
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-navy text-orange"
                  >
                    <Check className="h-5 w-5" strokeWidth={3} />
                  </span>
                  <p className="m-0 min-w-0 flex-1 leading-tight">
                    <span className="flex items-center justify-between gap-2 text-[11px] text-muted">
                      <span className="font-semibold tracking-[0.02em] uppercase">
                        {copy.notifyApp}
                      </span>
                      <span>{copy.notifyNow}</span>
                    </span>
                    <span className="mt-0.5 block text-[13px] font-bold text-heading">
                      {copy.notifyTitle}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-secondary">
                      {copy.notifyBody}
                    </span>
                  </p>
                </div>
              </Beat>

              {/* The result: what the missed call became. */}
              <Beat
                on={at(B.result)}
                data-wf-result
                className="tc-wf-pop absolute inset-x-3 bottom-[18px] z-40"
              >
                <div className="flex items-center gap-2.5 rounded-[16px] bg-navy px-3 py-2.5 text-white shadow-[0_20px_36px_-18px_rgb(var(--ink-rgb)/0.7)]">
                  <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-[#ff9b8f]"
                  >
                    <PhoneMissed className="h-4 w-4" strokeWidth={2.2} />
                  </span>
                  <p className="m-0 min-w-0 flex-1 leading-tight">
                    <span className="block text-[13.5px] font-extrabold">
                      <span className="whitespace-nowrap">
                        {copy.resultFrom}
                      </span>{" "}
                      <span className="whitespace-nowrap text-orange-dark">
                        <span aria-hidden className="pr-1.5 text-orange">
                          →
                        </span>
                        {copy.resultTo}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-white/75">
                      {copy.resultNote}
                    </span>
                  </p>
                  <span
                    aria-hidden
                    className="tc-wf-check flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green text-navy"
                  >
                    {booked ? (
                      <CalendarCheck className="h-4 w-4" strokeWidth={2.2} />
                    ) : (
                      <ClipboardList className="h-4 w-4" strokeWidth={2.2} />
                    )}
                  </span>
                </div>
              </Beat>

              {/* Glass sheen and home indicator. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 z-50 rounded-[39px] bg-[linear-gradient(115deg,rgb(255_255_255/0.16)_0%,rgb(255_255_255/0)_32%)]"
              />
              <span
                aria-hidden
                className={cn(
                  "absolute bottom-2 left-1/2 z-50 h-[5px] w-28 -translate-x-1/2 rounded-full transition-colors duration-500",
                  onCall ? "bg-white/70" : "bg-navy/80",
                )}
              />
            </div>
          </div>
        </div>

        {/* Floating notices. They repeat the screen, so they are decoration,
            and they sit over its status bar and home bar, never its text. */}
        <Beat
          aria-hidden
          on={at(B.sms1)}
          className={cn(
            NOTICE,
            "tc-wf-rise top-[20px] left-[max(0px,calc(50%-var(--wf-phone)/2-40px))]",
          )}
        >
          <Zap className="h-4 w-4 text-ember-text" strokeWidth={2.2} />
          <span className="max-w-[104px] text-[12.5px] leading-tight font-bold text-heading">
            {copy.noticeLeft}
          </span>
        </Beat>
        <Beat
          aria-hidden
          on={at(B.notify)}
          className={cn(
            NOTICE,
            "tc-wf-rise right-[max(0px,calc(50%-var(--wf-phone)/2-40px))] bottom-0",
          )}
        >
          {booked ? (
            <CalendarCheck
              className="h-4 w-4 text-signal-text"
              strokeWidth={2.1}
            />
          ) : (
            <ClipboardList
              className="h-4 w-4 text-signal-text"
              strokeWidth={2.1}
            />
          )}
          <span className="max-w-[104px] text-[12.5px] leading-tight font-bold text-heading">
            {copy.noticeRight}
          </span>
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
 * What TradeCatch does between messages. Booked: it checks the calendar, shows
 * the open slots it may offer, and marks the one the customer chose. Request
 * (scheduling not verified): it organizes what the customer said (the
 * need, name and address), for the owner to confirm a time.
 */
function WorkCard({
  copy,
  booked,
  phase,
}: {
  copy: WorkflowPhoneCopy;
  booked: boolean;
  phase: "working" | "found" | "done";
}) {
  const working = phase === "working";
  const chosen = phase === "done";
  const Icon = booked ? CalendarCheck : ClipboardList;
  return (
    <div className="rounded-[var(--radius-md)] border border-[rgb(var(--ink-rgb)/0.1)] bg-surface p-2.5 shadow-[0_8px_18px_-14px_rgb(var(--ink-rgb)/0.35)]">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-navy text-orange"
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
        </span>
        <p className="m-0 min-w-0 flex-1 leading-tight">
          <span className="block text-[12.5px] font-bold text-heading">
            {copy.cardTitle}
          </span>
          <span className="relative block h-4 text-[11.5px]">
            <Beat
              as="span"
              on={working}
              aria-hidden
              className="tc-wf-fade absolute inset-x-0 top-0 flex items-center gap-1 text-muted"
            >
              <LoaderCircle
                aria-hidden
                className={cn("h-3 w-3", working && "tc-wf-spin")}
                strokeWidth={2.4}
              />
              {copy.cardWorking}
            </Beat>
            <Beat
              as="span"
              on={phase === "found"}
              aria-hidden
              className="tc-wf-fade absolute inset-x-0 top-0 block truncate font-semibold text-heading"
            >
              {copy.cardFound}
            </Beat>
            <Beat
              as="span"
              on={chosen}
              className="tc-wf-fade absolute inset-x-0 top-0 block truncate font-semibold text-signal-text"
            >
              {copy.cardDone}
            </Beat>
          </span>
        </p>
      </div>
      <ul className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0">
        {copy.chips.map((chip, index) => {
          const busy = booked && index === 0;
          const picked = booked && chosen && index === 1;
          return (
            <li
              key={chip}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium transition-colors duration-500",
                busy &&
                  "border-[rgb(var(--ink-rgb)/0.1)] bg-paper-deep/60 text-muted line-through",
                !busy &&
                  !picked &&
                  "border-[rgb(var(--ink-rgb)/0.16)] bg-surface text-heading",
                picked && "border-signal-text bg-signal-text text-white",
              )}
            >
              {picked ? (
                <Check aria-hidden className="h-3 w-3" strokeWidth={3} />
              ) : null}
              {chip}
              {busy ? (
                <span className="sr-only"> ({copy.slotBusy})</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Something that enters at its beat. Hidden beats keep their space, so nothing
 * on the screen reflows while the workflow plays, and they stay in the
 * accessibility tree, so a screen reader always gets the whole story.
 */
function Beat({
  on,
  as: Tag = "div",
  className,
  children,
  "aria-hidden": ariaHidden,
  slot,
  typing = false,
  ...data
}: {
  on: boolean;
  as?: "div" | "li" | "span";
  "data-wf-result"?: boolean;
  className?: string;
  children: ReactNode;
  "aria-hidden"?: boolean;
  slot?: string;
  typing?: boolean;
}) {
  return (
    <Tag
      data-wf-beat
      data-on={on ? "true" : "false"}
      data-wf-slot={slot}
      data-wf-typing={typing ? "" : undefined}
      aria-hidden={ariaHidden}
      className={className}
      {...data}
    >
      {children}
    </Tag>
  );
}

function Message({
  slot,
  side,
  on,
  typing = false,
  note,
  children,
}: {
  slot: string;
  side: "in" | "out";
  on: boolean;
  typing?: boolean;
  note?: string;
  children: ReactNode;
}) {
  const out = side === "out";
  return (
    <li
      data-wf-slot={slot}
      className={cn(
        "relative flex flex-col",
        out ? "items-end" : "items-start",
      )}
    >
      <Beat
        on={typing}
        typing
        aria-hidden
        className={cn(
          "tc-wf-fade absolute top-0 flex h-8 items-center gap-1 rounded-[18px] px-3.5",
          out
            ? "right-0 bg-navy"
            : "left-0 border border-[rgb(var(--ink-rgb)/0.12)] bg-surface",
        )}
      >
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className={cn(
              "tc-wf-dot h-1.5 w-1.5 rounded-full",
              out ? "bg-white/80" : "bg-muted",
            )}
            style={{ animationDelay: `${dot * 140}ms` }}
          />
        ))}
      </Beat>
      <Beat
        on={on}
        className={cn(
          "flex max-w-[84%] flex-col",
          out ? "tc-wf-out items-end" : "tc-wf-in items-start",
        )}
      >
        <p
          className={cn(
            "m-0 rounded-[18px] px-3 py-2 text-[13px] leading-[1.38]",
            out
              ? "rounded-br-[6px] bg-navy text-white"
              : "rounded-bl-[6px] border border-[rgb(var(--ink-rgb)/0.12)] bg-surface text-heading",
          )}
        >
          {children}
        </p>
        {note ? (
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-muted">
            <Zap
              aria-hidden
              className="h-3 w-3 text-ember-text"
              strokeWidth={2.4}
            />
            {note}
          </span>
        ) : null}
      </Beat>
    </li>
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
      <span>8:12</span>
      <span className="absolute top-[11px] left-1/2 h-[25px] w-[92px] -translate-x-1/2 rounded-full bg-[#05090e]" />
      <span className="flex items-center gap-1">
        <Signal className="h-3.5 w-3.5" strokeWidth={2.4} />
        <Wifi className="h-3.5 w-3.5" strokeWidth={2.4} />
        <BatteryFull className="h-4 w-4" strokeWidth={2} />
      </span>
    </div>
  );
}
