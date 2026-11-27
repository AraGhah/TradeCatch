"use client";

import { useEffect, useRef, useState } from "react";
import { HardHat, PhoneCall, RotateCcw, Square, UserRound } from "lucide-react";

export type SignalFlowCopy = {
  label: string;
  nodes: { title: string; body: string }[];
  packets: string[];
  stop: string;
  replay: string;
  steps: { title: string; body: string }[];
};

/**
 * Which way each numbered step travels: 0 is the customer, 1 TradeCatch, 2
 * you. It follows the steps as written: the call comes in, the receptionist
 * asks, the details are recorded, you are alerted, a text follows up, and the
 * appointment reaches you.
 */
const HOPS: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, 1],
  [1, 2],
  [1, 0],
  [1, 2],
];
const HOP_MS = 1500;
const DONE = HOPS.length;

const NODE_ICONS = [UserRound, PhoneCall, HardHat];

/**
 * The six steps as a live diagram: a labelled packet runs along the line
 * between the customer, TradeCatch and you, and the matching step lights up
 * as it arrives. It plays once, when the diagram is mostly on screen, and
 * rests with every line drawn. The steps stay a plain ordered list, which is
 * also what the page shows before any script runs, with reduced motion, and
 * once it is over. Hovering a step shows where its information goes.
 */
export function SignalFlow({ copy }: { copy: SignalFlowCopy }) {
  const [hop, setHop] = useState(DONE);
  const [hovered, setHovered] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const playing = hop < DONE;

  useEffect(() => {
    const node = root.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        setHop(0);
      },
      { threshold: 0.45 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setHop((h) => h + 1), HOP_MS);
    return () => window.clearTimeout(timer);
  }, [hop, playing]);

  // The packet shown: the one travelling, or the hovered step's at rest.
  const shown = playing ? hop : hovered;
  const route = shown === null ? null : HOPS[shown];
  const track = route ? (Math.min(...route) === 0 ? 0 : 1) : null;
  const forward = route ? route[1] > route[0] : true;
  const drawn = (t: number) =>
    !playing ||
    HOPS.slice(0, hop + 1).some(
      ([a, b]) => (Math.min(a, b) === 0 ? 0 : 1) === t,
    );
  const lit = (n: number) => (route ? route.includes(n) : false);

  return (
    <div
      ref={root}
      className="tc-sf"
      data-playing={playing ? "" : undefined}
      data-hover={!playing && hovered !== null ? "" : undefined}
    >
      <figure className="m-0" aria-label={copy.label}>
        <div className="relative mx-auto flex max-w-[880px] items-stretch">
          {copy.nodes.map((node, n) => {
            const Icon = NODE_ICONS[n];
            return (
              <div key={node.title} className="contents">
                {n > 0 ? (
                  <div
                    aria-hidden
                    className="tc-sf-track relative flex-1 self-center"
                    data-drawn={drawn(n - 1) ? "" : undefined}
                  >
                    <span className="tc-sf-line" />
                    {track === n - 1 && shown !== null ? (
                      <span
                        key={`${shown}-${playing ? "run" : "rest"}`}
                        className="tc-sf-run"
                        data-dir={forward ? "fwd" : "back"}
                        data-mode={playing ? "run" : "rest"}
                      >
                        <span className="tc-sf-packet">
                          {copy.packets[shown]}
                        </span>
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <div
                  className="tc-sf-node flex w-[180px] shrink-0 flex-col items-center rounded-[var(--radius-lg)] border bg-surface px-3 py-4 text-center"
                  data-lit={lit(n) ? "" : undefined}
                  data-brand={n === 1 ? "" : undefined}
                >
                  <span
                    aria-hidden
                    className={`grid h-11 w-11 place-items-center rounded-full ${
                      n === 1
                        ? "bg-navy text-orange"
                        : "bg-paper-deep text-heading"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="mt-2 font-heading text-[16px] font-bold tracking-[-0.02em] text-heading">
                    {node.title}
                  </span>
                  <span className="mt-0.5 text-[13px] leading-[1.4] text-muted">
                    {node.body}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </figure>

      <ol className="m-0 mt-[clamp(20px,2.4vw,28px)] grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {copy.steps.map((step, i) => (
          <li
            key={step.title}
            className="tc-sf-step tc-card p-5"
            data-state={
              !playing
                ? "rest"
                : i < hop
                  ? "done"
                  : i === hop
                    ? "active"
                    : "next"
            }
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <p className="text-ui flex items-center gap-2 text-[12px] font-medium text-muted">
              <span className="tc-sf-num">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="tc-sf-tag" aria-hidden>
                {copy.packets[i]}
              </span>
            </p>
            <h3 className="text-card-title mt-2 text-heading">{step.title}</h3>
            <p className="mt-1.5 text-[14.5px] leading-[1.55] text-muted">
              {step.body}
            </p>
          </li>
        ))}
      </ol>

      <div className="mt-3 flex justify-center">
        <button
          type="button"
          onClick={() => setHop(playing ? DONE : 0)}
          className="tc-sf-control inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-[13.5px] font-semibold text-secondary hover:text-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
        >
          {playing ? (
            <Square aria-hidden className="h-3 w-3" fill="currentColor" />
          ) : (
            <RotateCcw aria-hidden className="h-3.5 w-3.5" />
          )}
          {playing ? copy.stop : copy.replay}
        </button>
      </div>
    </div>
  );
}
