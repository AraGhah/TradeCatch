"use client";

import { DEMO_DATA } from "../timeline";
import { SmartphoneFrame } from "../parts/SmartphoneFrame";
import type { SceneProps } from "../DemoVideoExperience";

export function Scene2MissedCallSMS({ p, locale, copy }: SceneProps) {
  const showOutgoing = p >= 0.08;
  const showAutoBadge = p >= 0.18;
  const showLang = p >= 0.48;
  const showSecond = p >= 0.52;

  // The viewer's own language answers first; the other one demonstrates that
  // the replies are bilingual rather than sent in the wrong language.
  const first = locale === "fr" ? copy.smsFr : copy.smsEn;
  const second = locale === "fr" ? copy.smsEn : copy.smsFr;
  const firstTag = locale === "fr" ? "FR" : "EN";
  const secondTag = locale === "fr" ? "EN" : "FR";

  const typedFirst = ramp(first, p, 0.08, 0.38);
  const typedSecond = ramp(second, p, 0.52, 0.82);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0c141e]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(228,118,43,0.1),transparent_50%)]" />
      <div className="relative z-10 w-full max-w-[620px] px-6">
        <SmartphoneFrame title={copy.companyTitle} statusTime="2:48">
          <div className="flex h-full flex-col bg-[#101820] px-4 pt-3 pb-4">
            <div className="mb-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
              <p className="text-[13px] tracking-wide text-orange uppercase">
                {copy.missedCallLabel}
              </p>
              <p className="text-[17px] font-semibold text-white">{DEMO_DATA.customer}</p>
              <p className="font-mono text-[13px] text-white/45">{DEMO_DATA.customerPhone}</p>
            </div>

            {showLang ? (
              <div className="mb-3 flex flex-col items-center gap-1.5">
                <div className="flex gap-2">
                  <span
                    className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${
                      !showSecond ? "bg-orange text-navy" : "bg-white/10 text-white/70"
                    }`}
                  >
                    {firstTag}
                  </span>
                  <span
                    className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${
                      showSecond ? "bg-orange text-navy" : "bg-white/10 text-white/70"
                    }`}
                  >
                    {secondTag}
                  </span>
                </div>
                <p className="text-[12px] text-white/45">{copy.bilingualLabel}</p>
              </div>
            ) : null}

            <div className="flex flex-1 flex-col gap-3">
              {showOutgoing && !showSecond ? (
                <OutgoingBubble
                  text={typedFirst}
                  time="2:48 PM"
                  badge={showAutoBadge ? copy.sentAuto : undefined}
                />
              ) : null}
              {showSecond ? (
                <OutgoingBubble text={typedSecond} time="2:48 PM" badge={copy.autoSecondLang} />
              ) : null}
            </div>
          </div>
        </SmartphoneFrame>
      </div>
    </div>
  );
}

function OutgoingBubble({
  text,
  time,
  badge,
}: {
  text: string;
  time: string;
  badge?: string;
}) {
  return (
    <div className="ml-6 flex flex-col items-end gap-1.5">
      <div className="rounded-2xl rounded-br-md bg-[#1e6b47] px-4 py-3.5 text-[20px] leading-snug text-white">
        {text}
        {text.length > 0 && text.length < 24 ? (
          <span className="ml-0.5 animate-pulse">|</span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {badge ? (
          <span className="rounded-full bg-orange/15 px-2.5 py-1 text-[12px] font-medium text-orange">
            {badge}
          </span>
        ) : null}
        <span className="text-[12px] text-white/40">{time}</span>
      </div>
    </div>
  );
}

/** Reveals `full` character by character between two scene fractions. */
export function ramp(full: string, p: number, from: number, to: number) {
  if (p >= to) return full;
  if (p <= from) return "";
  const ratio = (p - from) / (to - from);
  return full.slice(0, Math.max(1, Math.floor(full.length * ratio)));
}
