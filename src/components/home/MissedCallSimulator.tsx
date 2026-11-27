"use client";

import { useEffect, useRef, useState } from "react";
import {
  BellRing,
  CalendarCheck,
  Check,
  ClipboardList,
  FastForward,
  Clock3,
  MessageSquareText,
  PhoneIncoming,
  PhoneMissed,
  RotateCcw,
  Zap,
} from "lucide-react";

export type SimulatorCopy = {
  badge: string;
  title: string;
  intro: string;
  tradeLabel: string;
  trades: { id: string; label: string; ask: string; service: string }[];
  start: string;
  again: string;
  skip: string;
  note: string;
  appTitle: string;
  today: string;
  newToday: string;
  empty: string;
  newCustomer: string;
  line: string;
  textBack: string;
  reply: string;
  confirm: string;
  threadLabel: string;
  fieldService: string;
  fieldName: string;
  fieldAddress: string;
  fieldWhen: string;
  name: string;
  address: string;
  when: string;
  weekLabel: string;
  days: string[];
  otherJob: string;
  tentative: string;
  notifyTitle: string;
  resultFrom: string;
  resultTo: string;
  status: {
    ringing: string;
    missed: string;
    texted: string;
    replied: string;
    captured: string;
    scheduled: string;
  };
};

/**
 * The phases of one missed call, and when each starts (ms after the click).
 * idle → ringing → missed → texted → replied → captured → scheduled → notified.
 */
const PHASES = [
  "idle",
  "ringing",
  "missed",
  "texted",
  "replied",
  "captured",
  "scheduled",
  "notified",
] as const;
type Phase = (typeof PHASES)[number];
const AT: Record<Exclude<Phase, "idle">, number> = {
  ringing: 0,
  missed: 1500,
  texted: 2600,
  replied: 4000,
  captured: 5400,
  scheduled: 6900,
  notified: 8300,
};
const ORDER = (p: Phase) => PHASES.indexOf(p);

/**
 * A visitor misses a call on purpose and watches both sides of it: the text
 * the customer receives and the request as it lands in the dashboard. It is
 * a scripted simulation that runs entirely in the browser: no request is
 * sent, nothing is stored. Every element has its place from the start, so
 * nothing on the page moves while it plays. With reduced motion the result
 * appears at once.
 */
export function MissedCallSimulator({
  copy,
  booked,
}: {
  copy: SimulatorCopy;
  booked: boolean;
}) {
  const [tradeId, setTradeId] = useState(copy.trades[0]?.id ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const timers = useRef<number[]>([]);
  const trade = copy.trades.find((t) => t.id === tradeId) ?? copy.trades[0];
  const at = ORDER(phase);
  const reached = (p: Phase) => at >= ORDER(p);
  const running = phase !== "idle" && phase !== "notified";

  const clear = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };
  useEffect(() => clear, []);

  const run = () => {
    clear();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("notified");
      return;
    }
    setPhase("idle");
    for (const [p, ms] of Object.entries(AT) as [Phase, number][]) {
      timers.current.push(window.setTimeout(() => setPhase(p), ms + 60));
    }
  };

  // While it plays, the same button jumps to the finished result.
  const skip = () => {
    clear();
    setPhase("notified");
  };

  const pickTrade = (id: string) => {
    clear();
    setTradeId(id);
    setPhase("idle");
  };

  const status =
    phase === "idle"
      ? ""
      : phase === "notified"
        ? copy.status.scheduled
        : copy.status[phase];

  return (
    <div
      className="tc-sim"
      data-phase={phase}
      data-booked={booked ? "" : undefined}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-10">
        {/* Controls */}
        <div>
          <p className="m-0 inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--ink-rgb)/0.06)] px-2.5 py-1 text-[12.5px] font-semibold text-secondary">
            <Zap aria-hidden className="h-3.5 w-3.5 text-ember-text" />
            {copy.badge}
          </p>
          <h3 className="mt-3 font-heading text-[clamp(22px,2.2vw,28px)] font-extrabold tracking-[-0.03em] text-heading">
            {copy.title}
          </h3>
          <p className="mt-2 text-[15px] leading-[1.55] text-muted">
            {copy.intro}
          </p>

          <fieldset className="m-0 mt-5 border-0 p-0">
            <legend className="text-[13px] font-semibold text-secondary">
              {copy.tradeLabel}
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {copy.trades.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={t.id === tradeId}
                  onClick={() => pickTrade(t.id)}
                  className="tc-sim-trade min-h-10 rounded-full border px-3.5 text-[14px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </fieldset>

          <button
            type="button"
            onClick={running ? skip : run}
            className="tc-cta mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-orange px-[22px] text-[15px] font-semibold text-navy shadow-cta transition-[translate,scale,background] duration-200 hover:bg-orange-dark active:scale-[0.98] sm:w-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
          >
            {running ? (
              <FastForward aria-hidden className="h-4 w-4" />
            ) : phase === "notified" ? (
              <RotateCcw aria-hidden className="h-4 w-4" />
            ) : (
              <PhoneMissed aria-hidden className="h-4 w-4" />
            )}
            {running
              ? copy.skip
              : phase === "notified"
                ? copy.again
                : copy.start}
          </button>
          <p className="mt-3 text-[13px] leading-[1.5] text-muted">
            {copy.note}
          </p>
          <p aria-live="polite" className="sr-only">
            {status}
          </p>
        </div>

        {/* The dashboard, as the owner would see it. */}
        <div
          aria-hidden
          className="tc-sim-window relative overflow-hidden rounded-[var(--radius-xl)] border border-[rgb(var(--ink-rgb)/0.14)] bg-surface shadow-card"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[rgb(var(--ink-rgb)/0.08)] bg-paper px-4 py-2.5">
            <span className="flex items-center gap-2 font-heading text-[14px] font-bold text-heading">
              <ClipboardList className="h-4 w-4 text-ember-text" />
              {copy.appTitle}
              <span className="text-[12.5px] font-medium text-muted">
                · {copy.today}
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
              {copy.newToday}
              <span className="tc-sim-count relative grid h-5 min-w-5 place-items-center overflow-hidden rounded-full bg-navy px-1.5 text-[11.5px] font-bold text-white tabular-nums">
                <span data-show={!reached("texted") ? "" : undefined}>0</span>
                <span data-show={reached("texted") ? "" : undefined}>1</span>
              </span>
            </span>
          </div>

          <div className="grid sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
            {/* Request list */}
            <div className="relative border-b border-[rgb(var(--ink-rgb)/0.08)] p-3 sm:border-r sm:border-b-0">
              <p
                className="tc-sim-fade absolute inset-x-3 top-3 m-0 rounded-[12px] border border-dashed border-[rgb(var(--ink-rgb)/0.16)] px-3 py-4 text-center text-[13px] text-muted"
                data-show={!reached("texted") ? "" : undefined}
              >
                {copy.empty}
              </p>
              <div
                className="tc-sim-rise rounded-[12px] border border-orange/40 bg-orange/[0.06] p-3"
                data-show={reached("texted") ? "" : undefined}
              >
                <p className="m-0 flex items-center justify-between gap-2">
                  <span className="grid">
                    <span
                      className="tc-sim-fade truncate font-heading text-[14px] font-bold text-heading [grid-area:1/1]"
                      data-show={!reached("captured") ? "" : undefined}
                    >
                      {copy.newCustomer}
                    </span>
                    <span
                      className="tc-sim-fade truncate font-heading text-[14px] font-bold text-heading [grid-area:1/1]"
                      data-show={reached("captured") ? "" : undefined}
                    >
                      {copy.name}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11.5px] text-muted">
                    8:12
                  </span>
                </p>
                <p className="m-0 mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted">
                  <PhoneMissed className="h-3.5 w-3.5 text-[#a3312a]" />
                  {copy.status.missed}
                </p>
                <p className="m-0 mt-2 grid text-[11.5px] font-bold">
                  {(
                    ["texted", "replied", "captured", "scheduled"] as const
                  ).map((p, i, all) => {
                    const next = all[i + 1];
                    const on = reached(p) && (next ? !reached(next) : true);
                    const final = p === "scheduled";
                    return (
                      <span
                        key={p}
                        data-show={on ? "" : undefined}
                        className={`tc-sim-fade inline-flex w-fit items-center gap-1 self-start rounded-full px-2 py-0.5 [grid-area:1/1] ${
                          final
                            ? booked
                              ? "bg-green/12 text-signal-text"
                              : "bg-orange/15 text-ember-text"
                            : "bg-[rgb(var(--ink-rgb)/0.07)] text-secondary"
                        }`}
                      >
                        {final && booked ? (
                          <Check className="h-3 w-3" strokeWidth={3} />
                        ) : final ? (
                          <Clock3 className="h-3 w-3" strokeWidth={2.5} />
                        ) : null}
                        {copy.status[p]}
                      </span>
                    );
                  })}
                </p>
              </div>
            </div>

            {/* Request detail */}
            <div className="p-4">
              <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px]">
                {[
                  [copy.fieldService, trade.service, "captured"],
                  [copy.fieldName, copy.name, "captured"],
                  [copy.fieldAddress, copy.address, "captured"],
                  [copy.fieldWhen, copy.when, "scheduled"],
                ].map(([label, value, from], i) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-[11.5px] font-semibold text-muted">
                      {label}
                    </dt>
                    <dd className="relative m-0 mt-0.5 grid font-semibold text-heading">
                      <span
                        className="tc-sim-fade h-3 w-4/5 self-center rounded bg-[rgb(var(--ink-rgb)/0.07)] [grid-area:1/1]"
                        data-show={!reached(from as Phase) ? "" : undefined}
                      />
                      <span
                        className="tc-sim-rise truncate [grid-area:1/1]"
                        style={{ "--k": i } as React.CSSProperties}
                        data-show={reached(from as Phase) ? "" : undefined}
                      >
                        {value}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>

              <p className="m-0 mt-4 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted">
                <MessageSquareText className="h-3.5 w-3.5" />
                {copy.threadLabel}
              </p>
              <ol className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0 text-[12.5px] leading-[1.4]">
                {[
                  { text: copy.textBack, out: true, from: "texted" as Phase },
                  { text: trade.ask, out: false, from: "replied" as Phase },
                  { text: copy.reply, out: false, from: "captured" as Phase },
                  { text: copy.confirm, out: true, from: "scheduled" as Phase },
                ].map((m) => (
                  <li
                    key={m.from}
                    data-show={reached(m.from) ? "" : undefined}
                    className={`tc-sim-rise max-w-[88%] rounded-[12px] px-2.5 py-1.5 ${
                      m.out
                        ? "self-end rounded-br-[4px] bg-navy text-white"
                        : "self-start rounded-bl-[4px] bg-paper-deep text-heading"
                    }`}
                  >
                    {m.text}
                  </li>
                ))}
              </ol>

              <div className="mt-4">
                <p className="m-0 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted">
                  <CalendarCheck className="h-3.5 w-3.5" />
                  {copy.weekLabel}
                </p>
                <div className="mt-1.5 grid grid-cols-5 gap-1.5 text-[11px]">
                  {copy.days.map((day, d) => (
                    <div key={day} className="min-w-0">
                      <span className="block text-center font-semibold text-muted">
                        {day}
                      </span>
                      <span className="relative mt-1 grid h-9 rounded-[8px] bg-paper">
                        {d === 2 ? (
                          <span className="m-0.5 grid place-items-center truncate rounded-[6px] bg-[rgb(var(--ink-rgb)/0.09)] px-1 font-semibold text-secondary">
                            {copy.otherJob}
                          </span>
                        ) : null}
                        {d === 3 ? (
                          <span
                            data-show={reached("scheduled") ? "" : undefined}
                            className={`tc-sim-drop m-0.5 grid place-items-center truncate rounded-[6px] px-1 font-bold ${
                              booked
                                ? "bg-green text-white"
                                : "border border-dashed border-orange bg-orange/10 text-ember-text"
                            }`}
                          >
                            {booked ? copy.name : copy.tentative}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* The result, in its reserved strip. */}
          <div className="border-t border-[rgb(var(--ink-rgb)/0.08)] bg-navy px-4 py-2.5 text-white">
            <p
              className="tc-sim-rise m-0 flex items-center gap-2 text-[13px] font-bold"
              data-show={reached("notified") ? "" : undefined}
            >
              <span className="grid h-5 w-5 place-items-center rounded-full bg-green">
                <Check className="h-3 w-3" strokeWidth={3.5} />
              </span>
              {copy.resultFrom}
              <span className="text-orange">→</span>
              <span className="text-orange-dark">{copy.resultTo}</span>
            </p>
          </div>

          {/* Call and notification, over the window like on a real screen. */}
          <div className="pointer-events-none absolute top-12 right-3 left-3 sm:left-auto sm:w-[17rem]">
            <div
              className="tc-sim-toast absolute inset-x-0 top-0 flex items-center gap-2.5 rounded-[14px] bg-navy px-3 py-2.5 text-white shadow-card"
              data-show={
                reached("ringing") && !reached("texted") ? "" : undefined
              }
            >
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                  reached("missed") ? "bg-[#a3312a]" : "tc-sim-ring bg-green"
                }`}
              >
                {reached("missed") ? (
                  <PhoneMissed className="h-4 w-4" />
                ) : (
                  <PhoneIncoming className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0 text-[12.5px] leading-[1.3]">
                <span className="block font-bold">
                  {reached("missed") ? copy.status.missed : copy.status.ringing}
                </span>
                <span className="block truncate text-white/70">
                  {copy.line}
                </span>
              </span>
            </div>
            <div
              className="tc-sim-toast tc-sim-flash absolute inset-x-0 top-0 flex items-center gap-2.5 rounded-[14px] border border-[rgb(var(--ink-rgb)/0.1)] bg-surface px-3 py-2.5 shadow-card"
              data-show={reached("notified") ? "" : undefined}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-orange text-navy">
                <BellRing className="h-4 w-4" />
              </span>
              <span className="min-w-0 text-[12.5px] leading-[1.3]">
                <span className="block font-bold text-heading">
                  {copy.notifyTitle}
                </span>
                <span className="block truncate text-muted">
                  {copy.name} · {trade.service}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
