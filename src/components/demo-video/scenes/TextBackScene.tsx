"use client";

import { DEMO_DATA } from "../timeline";
import { SmartphoneFrame } from "../parts/SmartphoneFrame";
import { ramp, reveal } from "../parts/sceneKit";
import type { SceneProps } from "../DemoVideoExperience";

/** Missed call → automatic SMS → customer reply. */
export function TextBackScene({ p, copy }: SceneProps) {
  const missedIn = p >= 0.04;
  const smsFrom = 0.14;
  const smsTo = 0.42;
  const replyIn = p >= 0.62;
  const typed = ramp(copy.textBackSms, p, smsFrom, smsTo);
  const step = replyIn ? 2 : p >= smsFrom ? 1 : 0;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0c141e]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_40%,rgba(228,118,43,0.12),transparent_50%)]" />

      <div className="relative z-10 grid w-full max-w-[1240px] grid-cols-[0.9fr_1.1fr] items-center gap-10 px-10">
        <ol className="space-y-4">
          {copy.textBackFlow.map((label, i) => (
            <li
              key={label}
              className={`flex items-center gap-5 rounded-2xl border px-6 py-5 transition-all duration-500 ${
                i <= step
                  ? "border-orange/45 bg-orange/[0.1]"
                  : "border-white/[0.06] bg-white/[0.02] opacity-40"
              }`}
            >
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-mono text-[17px] font-semibold ${
                  i <= step ? "bg-orange text-navy" : "bg-white/10 text-white/50"
                }`}
              >
                {i + 1}
              </span>
              <span className="text-[26px] font-semibold tracking-[-0.02em] text-white">
                {label}
              </span>
            </li>
          ))}
        </ol>

        <SmartphoneFrame title={copy.companyTitle} statusTime="2:48">
          <div className="flex h-full flex-col bg-[#101820] px-4 pt-3 pb-4">
            <div
              className={`mb-4 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 ${reveal(missedIn)}`}
            >
              <p className="text-[13px] tracking-wide text-orange uppercase">
                {copy.missedCallLabel} · 2:47 PM
              </p>
              <p className="text-[17px] font-semibold text-white">{DEMO_DATA.customer}</p>
              <p className="font-mono text-[13px] text-white/45">{DEMO_DATA.customerPhone}</p>
            </div>

            <div className="flex flex-1 flex-col gap-3">
              {typed ? (
                <div className="ml-6 flex flex-col items-end gap-1.5">
                  <div className="rounded-2xl rounded-br-md bg-[#1e6b47] px-4 py-3.5 text-[20px] leading-snug text-white">
                    {typed}
                  </div>
                  <span
                    className={`rounded-full bg-orange/15 px-2.5 py-1 text-[12px] font-medium text-orange ${reveal(p >= smsTo)}`}
                  >
                    {copy.sentAutomatically} · 2:48 PM
                  </span>
                </div>
              ) : null}
              <div className={`mr-6 ${reveal(replyIn, "left")}`}>
                <div className="rounded-2xl rounded-bl-md bg-[#1c2734] px-4 py-3.5 text-[20px] leading-snug text-white/90">
                  {copy.textBackReply}
                </div>
                <span className="mt-1 block text-[12px] text-white/50">2:49 PM</span>
              </div>
            </div>
          </div>
        </SmartphoneFrame>
      </div>
    </div>
  );
}
