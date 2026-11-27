"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

export type LossRecoveryCopy = {
  label: string;
  without: string;
  with: string;
  lost: string;
  recovered: string;
  cards: { title: string; body: string; saved: string[] }[];
};

type Mode = "without" | "with";

/**
 * The same three moments, told twice: how each job slips away today, and how
 * it is kept with TradeCatch. Both versions sit in the same grid cell, so the
 * cards never change height when they swap. The page renders "without" (the
 * original cards); once the section is half on screen it holds that for a
 * moment, then turns once to "with". After that the visitor decides. With
 * reduced motion it does not turn by itself.
 */
export function LossRecovery({
  copy,
  compact = false,
}: {
  copy: LossRecoveryCopy;
  compact?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("without");
  const touched = useRef(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = root.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: number | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        timer = window.setTimeout(() => {
          if (!touched.current) setMode("with");
        }, 2400);
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  const choose = (next: Mode) => {
    touched.current = true;
    setMode(next);
  };

  return (
    <div ref={root} className="tc-lr" data-mode={mode}>
      <div
        role="group"
        aria-label={copy.label}
        className={`tc-lr-toggle mx-auto flex w-fit rounded-full border border-[rgb(var(--ink-rgb)/0.14)] p-1 ${
          compact ? "mt-1 bg-surface" : "mt-[clamp(18px,2vw,24px)] bg-paper"
        }`}
      >
        {(["without", "with"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => choose(value)}
            className="tc-lr-option min-h-10 rounded-full px-4 text-[14px] font-semibold text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
          >
            {value === "with" ? copy.with : copy.without}
          </button>
        ))}
      </div>

      <ol
        className={`m-0 grid list-none p-0 ${
          compact
            ? "mt-4 gap-2.5 md:grid-cols-1"
            : "mt-[clamp(16px,2vw,22px)] gap-5 lg:grid-cols-3"
        }`}
      >
        {copy.cards.map((card, i) => (
          <li
            key={card.title}
            style={{ "--i": i } as React.CSSProperties}
            className={`tc-lr-card flex flex-col rounded-[var(--radius-lg)] border ${
              compact ? "bg-surface p-4" : "bg-paper p-6"
            }`}
          >
            <h3
              className={
                compact
                  ? "font-heading text-[16px] font-bold tracking-[-0.025em] text-heading"
                  : "text-card-title text-heading"
              }
            >
              {card.title}
            </h3>

            {/* Both versions share one cell, so the card keeps its height. */}
            <div className="mt-2 grid flex-1">
              <p
                data-face="without"
                aria-hidden={mode !== "without"}
                className={`tc-lr-face m-0 leading-[1.6] text-muted ${
                  compact ? "text-[14px]" : "text-[15px]"
                }`}
              >
                {card.body}
              </p>
              <ol
                data-face="with"
                aria-hidden={mode !== "with"}
                className="tc-lr-face m-0 flex list-none flex-col gap-2 p-0"
              >
                {card.saved.map((line, j) => (
                  <li
                    key={line}
                    style={{ "--j": j } as React.CSSProperties}
                    className={`tc-lr-row flex items-start gap-2.5 leading-[1.45] text-secondary ${
                      compact ? "text-[14px]" : "text-[14.5px]"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full ${
                        j === card.saved.length - 1
                          ? "bg-green text-white"
                          : "bg-orange/15"
                      }`}
                    >
                      {j === card.saved.length - 1 ? (
                        <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-orange" />
                      )}
                    </span>
                    {line}
                  </li>
                ))}
              </ol>
            </div>

            <p className="m-0 mt-4 grid text-[13px] font-bold">
              <span
                data-face="without"
                aria-hidden={mode !== "without"}
                className="tc-lr-face tc-lr-chip inline-flex w-fit items-center gap-1.5 rounded-full bg-[#a3312a]/10 px-2.5 py-1 text-[#8f2a24]"
              >
                <X aria-hidden className="h-3.5 w-3.5" strokeWidth={3} />
                {copy.lost}
              </span>
              <span
                data-face="with"
                aria-hidden={mode !== "with"}
                className="tc-lr-face tc-lr-chip inline-flex w-fit items-center gap-1.5 rounded-full bg-green/12 px-2.5 py-1 text-signal-text"
              >
                <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={3} />
                {copy.recovered}
              </span>
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
