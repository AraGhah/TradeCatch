"use client";

import { DEMO_DATA, type DemoCopy } from "../timeline";
import type { SceneProps } from "../DemoVideoExperience";

export function Scene1ContractorWork({ p, copy }: SceneProps) {
  const ringing = p < 0.55;
  const missed = p >= 0.55;
  const showSecondLine = p >= 0.42;

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[#0c141e]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_25%_15%,rgba(228,118,43,0.14),transparent_50%),radial-gradient(ellipse_at_85%_75%,rgba(47,158,104,0.07),transparent_48%)]" />

      <div className="relative z-10 grid w-full max-w-[1180px] grid-cols-1 items-center gap-6 px-8 lg:grid-cols-[1fr_0.9fr] lg:gap-10">
        <div className="relative">
          <ContractorIllustration ringing={ringing} />
          <p className="mt-5 max-w-[16ch] font-heading text-[clamp(30px,3.6vw,50px)] leading-[1.03] font-extrabold tracking-[-0.04em] text-white">
            {copy.headline1}
          </p>
          <p
            className={`mt-3 max-w-[26ch] text-[clamp(17px,1.6vw,22px)] leading-snug text-white/70 transition-all duration-500 ${
              showSecondLine ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
            }`}
          >
            {copy.headline2}
          </p>
        </div>

        <div className="flex justify-center">
          <RealisticPhone ringing={ringing} missed={missed} copy={copy} />
        </div>
      </div>
    </div>
  );
}

function RealisticPhone({
  ringing,
  missed,
  copy,
}: {
  ringing: boolean;
  missed: boolean;
  copy: DemoCopy;
}) {
  return (
    <div
      className={`relative h-[min(84vh,905px)] w-auto -translate-y-[5vh] ${
        ringing ? "animate-[phone-vibrate_0.28s_ease-in-out_infinite]" : ""
      }`}
      style={{ aspectRatio: "9 / 19.4" }}
    >
      <div className="absolute inset-0 rounded-[48px] bg-[#1a1d21] p-[11px] shadow-[0_40px_90px_-28px_rgba(0,0,0,0.95),inset_0_0_0_1px_rgba(255,255,255,0.08)]">
        <div className="absolute top-[12px] left-1/2 z-30 h-[30px] w-[124px] -translate-x-1/2 rounded-full bg-black" />
        <div className="relative h-full overflow-hidden rounded-[38px] bg-[#05070a]">
          <div className="absolute inset-0 bg-[linear-gradient(165deg,#1c2a3a_0%,#0b1018_45%,#15101a_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(228,118,43,0.18),transparent_40%)]" />

          <div className="relative z-10 flex items-center justify-between px-7 pt-4 text-[14px] font-semibold text-white/90">
            <span>2:47</span>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-end gap-[2px]" aria-hidden>
                {[5, 7, 9, 11].map((h) => (
                  <span key={h} className="w-[3px] rounded-[1px] bg-white" style={{ height: h }} />
                ))}
              </span>
              <span className="text-[11px] font-medium text-white/70">5G</span>
            </div>
          </div>

          <div className="relative z-10 flex h-[calc(100%-40px)] flex-col items-center px-6 pt-12 pb-9">
            <p className="text-[15px] tracking-[0.08em] text-white/55 uppercase">
              {missed ? copy.missedCall : copy.mobile}
            </p>
            <div className="mt-6 flex h-[104px] w-[104px] items-center justify-center rounded-full bg-[linear-gradient(145deg,#3d4f63,#243040)] text-[40px] font-semibold text-white shadow-[0_12px_30px_-12px_rgba(0,0,0,0.7)] ring-1 ring-white/10">
              SM
            </div>
            <p className="mt-6 text-[33px] font-semibold tracking-[-0.02em] text-white">
              {DEMO_DATA.customer}
            </p>
            <p className="mt-1 font-mono text-[16px] text-white/55">
              {DEMO_DATA.customerPhone}
            </p>
            <p className={`mt-4 text-[17px] font-medium ${missed ? "text-orange" : "text-white/70"}`}>
              {missed ? copy.missedCall : copy.incomingCall}
            </p>

            <div className="mt-auto flex w-full items-end justify-between px-2 pb-2">
              {missed ? (
                <div className="mx-auto rounded-full bg-white/10 px-6 py-3 text-[15px] font-medium text-white/80">
                  {copy.callUnanswered}
                </div>
              ) : (
                <>
                  <CallAction label={copy.decline} tone="decline" />
                  <CallAction label={copy.accept} tone="accept" />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CallAction({ label, tone }: { label: string; tone: "accept" | "decline" }) {
  const accept = tone === "accept";
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`flex h-[72px] w-[72px] items-center justify-center rounded-full ${
          accept ? "bg-[#34c759]" : "bg-[#ff3b30]"
        }`}
      >
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
          {accept ? (
            <path
              d="M7 3h3l1.5 4-2 1.5a12 12 0 006 6L17 13l4 1.5v3a2 2 0 01-2.2 2A16 16 0 015 7.2 2 2 0 017 3z"
              fill="white"
            />
          ) : (
            <path d="M6 6l12 12M18 6L6 18" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
          )}
        </svg>
      </div>
      <span className="text-[13px] text-white/70">{label}</span>
    </div>
  );
}

function ContractorIllustration({ ringing }: { ringing: boolean }) {
  return (
    <div className="relative h-[190px] w-full max-w-[420px]">
      <div className="absolute right-0 bottom-6 left-0 h-px bg-white/15" />
      <svg viewBox="0 0 420 200" className="absolute inset-0 h-full w-full" aria-hidden>
        <rect x="40" y="110" width="180" height="48" rx="8" fill="#16222f" stroke="rgba(255,255,255,0.12)" />
        <rect x="150" y="78" width="70" height="40" rx="6" fill="#1a2838" stroke="rgba(255,255,255,0.1)" />
        <rect x="50" y="118" width="50" height="28" rx="4" fill="#e4762b" opacity="0.9" />
        <circle cx="80" cy="165" r="14" fill="#0c141e" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
        <circle cx="180" cy="165" r="14" fill="#0c141e" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
        <circle cx="280" cy="95" r="16" fill="#c4a484" />
        <rect x="262" y="112" width="36" height="46" rx="8" fill="#2f6f9e" />
        <rect x="248" y="120" width="14" height="28" rx="6" fill="#c4a484" />
        <rect x="298" y="120" width="14" height="28" rx="6" fill="#c4a484" />
        <rect x="266" y="158" width="12" height="28" rx="4" fill="#1a2430" />
        <rect x="282" y="158" width="12" height="28" rx="4" fill="#1a2430" />
        <rect x="308" y="128" width="42" height="8" rx="3" fill="#9aa3ad" transform="rotate(25 308 128)" />
        <rect x="330" y="70" width="14" height="70" rx="4" fill="#5c6875" />
        <circle cx="337" cy="145" r="5" fill="#4db8e8" opacity={ringing ? 0.9 : 0.5}>
          <animate attributeName="cy" values="145;160;145" dur="1.2s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  );
}
