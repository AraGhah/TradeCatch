"use client";

import { LogoMark } from "@/components/BrandLockup";
import { Avatar, VoiceBars, callClock, reveal } from "../parts/sceneKit";
import type { SceneProps } from "../DemoVideoExperience";

/** The same ringing call from the opening, now picked up by the receptionist. */
export function AnswerScene({ p, sec, scene, copy }: SceneProps) {
  const logoIn = p >= 0.02;
  const cardIn = p >= 0.1;
  const answered = p >= 0.42;
  const taglineIn = p >= 0.58;
  const answeredAt = 0.42 * scene.duration;

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[#0c141e]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(228,118,43,0.16),transparent_55%)]" />

      <div className="relative z-10 flex w-full max-w-[920px] -translate-y-[4vh] flex-col items-center px-8 text-center">
        <div className={`inline-flex items-center gap-3 ${reveal(logoIn)}`}>
          <LogoMark inverted className="!h-14 !w-14 !rounded-[16px]" />
          <span className="font-heading text-[44px] font-extrabold tracking-[-0.04em] text-white">
            TradeCatch
          </span>
        </div>

        <div
          className={`mt-10 w-full max-w-[640px] rounded-[24px] border bg-[#121c28] p-7 text-left shadow-[0_40px_80px_-40px_rgba(0,0,0,0.9)] transition-colors duration-500 ${
            answered ? "border-green/40" : "border-white/10"
          } ${reveal(cardIn)}`}
        >
          <div className="flex items-center gap-5">
            <div className="relative">
              {!answered ? (
                <span className="absolute inset-0 animate-ping rounded-full bg-orange/40" />
              ) : null}
              <Avatar initials={copy.callerInitials} size={72} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[30px] font-semibold tracking-[-0.02em] text-white">
                {copy.callerName}
              </p>
              <p className="font-mono text-[17px] text-white/55">{copy.callerPhone}</p>
            </div>
            {answered ? (
              <span className="font-mono text-[22px] text-white/70 tabular-nums">
                {callClock(sec - answeredAt)}
              </span>
            ) : null}
          </div>

          <div className="mt-6 flex items-center justify-between gap-4 border-t border-white/10 pt-5">
            <p
              className={`text-[21px] font-semibold ${
                answered ? "text-green" : "text-orange"
              }`}
            >
              {answered ? copy.answeredBy : copy.answerIncoming}
            </p>
            {answered ? <VoiceBars active tone="green" /> : null}
          </div>
          <div className="mt-4 flex gap-2">
            {[copy.answerLive, copy.answerLanguages].map((chip) => (
              <span
                key={chip}
                className={`rounded-full px-3.5 py-1.5 text-[15px] font-medium transition-all duration-500 ${
                  answered
                    ? "bg-green/15 text-green"
                    : "bg-white/[0.06] text-white/40"
                }`}
              >
                {chip}
              </span>
            ))}
          </div>
        </div>

        <p
          className={`mt-10 max-w-[18ch] font-heading text-[clamp(34px,3.8vw,54px)] leading-[1.04] font-extrabold tracking-[-0.04em] text-white ${reveal(taglineIn)}`}
        >
          {copy.answerTagline}
        </p>
      </div>
    </div>
  );
}
