"use client";

import type { ReactNode } from "react";

/** Reveals `full` character by character between two scene fractions. */
export function ramp(full: string, p: number, from: number, to: number) {
  if (p >= to) return full;
  if (p <= from) return "";
  const ratio = (p - from) / (to - from);
  return full.slice(0, Math.max(1, Math.floor(full.length * ratio)));
}

/** mm:ss for an in-call timer. */
export function callClock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Avatar({
  initials,
  size = 56,
  tone = "slate",
}: {
  initials: string;
  size?: number;
  tone?: "slate" | "ember";
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-1 ring-white/10 ${
        tone === "ember"
          ? "bg-[linear-gradient(145deg,#e4762b,#b85718)]"
          : "bg-[linear-gradient(145deg,#3d4f63,#243040)]"
      }`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
}

/** Animated voice bars; flat when nobody is speaking. */
export function VoiceBars({
  active,
  tone = "green",
  bars = 5,
}: {
  active: boolean;
  tone?: "green" | "ember" | "white";
  bars?: number;
}) {
  const color =
    tone === "ember" ? "bg-orange" : tone === "white" ? "bg-white/80" : "bg-green";
  return (
    <span className="inline-flex h-6 items-center gap-[3px]" aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className={`w-[4px] rounded-full ${color} ${
            active ? "animate-[demo-bars_0.9s_ease-in-out_infinite]" : ""
          }`}
          style={{
            height: active ? 22 : 5,
            animationDelay: `${i * 0.12}s`,
            transition: "height 0.25s ease",
          }}
        />
      ))}
    </span>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[22px] border border-white/10 bg-[#121c28] shadow-[0_40px_70px_-40px_rgba(0,0,0,0.8)] ${className}`}
    >
      {children}
    </div>
  );
}

/** Enter/exit helper so scenes read as a sequence of beats. */
export function reveal(shown: boolean, from: "up" | "left" | "right" = "up") {
  const hidden =
    from === "left"
      ? "-translate-x-6 opacity-0"
      : from === "right"
        ? "translate-x-6 opacity-0"
        : "translate-y-4 opacity-0";
  return `transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
    shown ? "translate-x-0 translate-y-0 opacity-100" : hidden
  }`;
}
