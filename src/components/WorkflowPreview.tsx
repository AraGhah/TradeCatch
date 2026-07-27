"use client";

import { useEffect, useState } from "react";

export function WorkflowPreview({
  steps,
  label,
}: {
  steps: string[];
  label: string;
}) {
  const [active, setActive] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    function sync() {
      setReduceMotion(media.matches);
    }
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (reduceMotion || steps.length === 0) return;
    const id = window.setInterval(() => {
      setActive((i) => (i + 1) % steps.length);
    }, 1100);
    return () => window.clearInterval(id);
  }, [reduceMotion, steps.length]);

  const row1 = steps.slice(0, 3);
  const row2 = steps.slice(3, 6);

  return (
    <div className="relative rounded-[20px] border border-[rgba(12,20,30,0.1)] bg-white p-[clamp(18px,2.5vw,28px)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[20px] opacity-70"
        style={{
          background:
            "radial-gradient(80% 60% at 90% 10%, rgba(228,118,43,0.1), transparent 55%)",
        }}
      />

      <FlowRow steps={row1} active={active} offset={0} />

      <div className="relative my-2.5 flex justify-center" aria-hidden>
        <span
          className={`block h-7 w-px transition-colors duration-300 ${
            active >= 3 ? "bg-orange" : "bg-[rgba(12,20,30,0.14)]"
          }`}
        />
      </div>

      <FlowRow steps={row2} active={active} offset={3} />

      <p className="relative mt-5 font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
        {label}
      </p>
    </div>
  );
}

function FlowRow({
  steps,
  active,
  offset,
}: {
  steps: string[];
  active: number;
  offset: number;
}) {
  return (
    <div className="relative flex items-stretch">
      {steps.map((label, i) => {
        const stepIndex = offset + i;
        const isActive = active === stepIndex;
        const isDone = active > stepIndex;
        const showArrow = i < steps.length - 1;

        return (
          <div key={`${label}-${stepIndex}`} className="flex min-w-0 flex-1 items-center">
            <div
              className={`relative flex min-h-[76px] flex-1 flex-col justify-center rounded-[12px] border px-3 py-3 transition-[background,border-color,box-shadow] duration-300 ${
                isActive
                  ? "border-orange/50 bg-[rgba(228,118,43,0.1)] shadow-[0_12px_28px_-18px_rgba(228,118,43,0.55)]"
                  : isDone
                    ? "border-[rgba(47,158,104,0.28)] bg-[rgba(47,158,104,0.06)]"
                    : "border-[rgba(12,20,30,0.1)] bg-paper"
              }`}
            >
              <span
                className={`font-mono text-[10px] font-semibold tracking-[0.1em] ${
                  isActive
                    ? "text-ember-text"
                    : isDone
                      ? "text-signal-text"
                      : "text-muted"
                }`}
              >
                {String(stepIndex + 1).padStart(2, "0")}
              </span>
              <span className="mt-1 text-[13.5px] font-semibold leading-snug tracking-[-0.015em] text-navy">
                {label}
              </span>
              {isActive ? (
                <span className="absolute top-2.5 right-2.5 h-1.5 w-1.5 animate-tc-pulse rounded-full bg-orange" />
              ) : null}
            </div>
            {showArrow ? (
              <span
                className={`mx-1 shrink-0 font-mono text-[14px] transition-colors duration-300 ${
                  active > stepIndex ? "text-orange" : "text-[rgba(12,20,30,0.22)]"
                }`}
                aria-hidden
              >
                →
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
