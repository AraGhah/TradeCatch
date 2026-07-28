"use client";

import type { ReactNode } from "react";

export function SmartphoneFrame({
  children,
  className = "",
  statusTime = "2:47",
  title,
  vibrate = false,
}: {
  children: ReactNode;
  className?: string;
  statusTime?: string;
  title?: string;
  vibrate?: boolean;
}) {
  return (
    <div
      // Height-driven so the frame can never overflow the 16:9 stage, and
      // nudged up so the caption band never covers the newest message.
      className={`relative mx-auto h-[min(84vh,905px)] w-auto -translate-y-[5vh] ${vibrate ? "animate-[phone-vibrate_0.35s_ease-in-out_infinite]" : ""} ${className}`}
      style={{ aspectRatio: "9 / 19.4" }}
    >
      <div className="absolute inset-0 rounded-[48px] bg-[#1a1d21] p-[11px] shadow-[0_40px_90px_-28px_rgba(0,0,0,0.95),inset_0_0_0_1px_rgba(255,255,255,0.08)]">
        <div className="relative flex h-full flex-col overflow-hidden rounded-[38px] bg-[#0b1016]">
          <div className="absolute top-[10px] left-1/2 z-20 h-[30px] w-[124px] -translate-x-1/2 rounded-full bg-black" />
          <div className="relative z-10 flex items-center justify-between px-6 pt-4 pb-1 text-[13px] font-semibold text-white/85">
            <span>{statusTime}</span>
            <span className="flex items-center gap-1.5 text-[11px] tracking-wide text-white/55">
              5G
              <span className="inline-block h-3 w-6 rounded-[2px] border border-white/70 p-px">
                <span className="block h-full w-[70%] rounded-[1px] bg-white/90" />
              </span>
            </span>
          </div>
          {title ? (
            <div className="border-b border-white/[0.06] px-4 py-3 text-center">
              <p className="text-[16px] font-semibold text-white">{title}</p>
              <p className="text-[11px] text-white/40">iMessage · Text</p>
            </div>
          ) : null}
          <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
      </div>
    </div>
  );
}
