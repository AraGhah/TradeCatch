"use client";

import { DEMO_DATA } from "../timeline";
import { SmartphoneFrame } from "../parts/SmartphoneFrame";
import type { SceneProps } from "../DemoVideoExperience";

export function Scene3CustomerQualification({ p, copy }: SceneProps) {
  const thread = [
    { side: "in" as const, text: copy.custLeak, at: 0.04 },
    { side: "out" as const, text: copy.waterOff, at: 0.2 },
    { side: "in" as const, text: copy.no, at: 0.32 },
    { side: "out" as const, text: copy.askPhoto, at: 0.42 },
    { side: "in" as const, text: DEMO_DATA.address, at: 0.6 },
    { side: "photo" as const, text: copy.photoReceived, at: 0.72 },
  ];

  const extracted = [
    // Row order stays severity-first (Emergency leads); reveal timing is
    // independent and must match when each fact actually appears on screen.
    // Pipe leak is stated in the customer's first message (0.04); emergency
    // status isn't confirmed until they reply "no" to "is the water shut
    // off?" (0.32) — so Emergency lights up after Pipe leak, not before.
    { label: copy.emergency, show: p >= 0.38 },
    { label: copy.pipeLeak, show: p >= 0.1 },
    { label: "Laval", show: p >= 0.64 },
    { label: copy.photoReceived, show: p >= 0.76 },
  ];

  const visible = thread.filter((m) => p >= m.at);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0c141e]">
      <div className="relative z-10 grid w-full max-w-[1180px] grid-cols-1 items-center gap-8 px-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="order-2 space-y-3 lg:order-1">
          <p className="font-mono text-[13px] tracking-[0.14em] text-white/45 uppercase">
            {copy.infoExtracted}
          </p>
          <div className="space-y-3">
            {extracted.map((item) => (
              <div
                key={item.label}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3.5 transition-all duration-300 ${
                  item.show
                    ? "translate-x-0 border-orange/35 bg-orange/10 opacity-100"
                    : "-translate-x-3 border-white/5 bg-white/[0.02] opacity-25"
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${item.show ? "bg-orange" : "bg-white/20"}`} />
                <span className="text-[19px] font-semibold text-white">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <SmartphoneFrame title={copy.companyTitle} statusTime="2:49">
            <div className="flex h-full flex-col justify-center gap-2.5 overflow-hidden bg-[#101820] px-3.5 py-3">
              {visible.map((msg, i) =>
                msg.side === "photo" ? (
                  <PhotoThumb key={msg.text} label={msg.text} />
                ) : (
                  <Bubble
                    key={msg.text + msg.at}
                    side={msg.side}
                    text={msg.text}
                    latest={i === visible.length - 1}
                  />
                ),
              )}
            </div>
          </SmartphoneFrame>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  side,
  text,
  latest,
}: {
  side: "in" | "out";
  text: string;
  latest: boolean;
}) {
  const outgoing = side === "out";
  return (
    <div className={`flex ${outgoing ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-4 py-3.5 leading-snug transition-all duration-200 ${
          latest ? "text-[21px] opacity-100" : "text-[18px] opacity-55"
        } ${
          outgoing
            ? "rounded-br-md bg-[#1e6b47] text-white"
            : "rounded-bl-md bg-[#1c2734] text-white/90"
        }`}
      >
        {text}
      </div>
    </div>
  );
}

function PhotoThumb({ label }: { label: string }) {
  return (
    <div className="flex justify-start">
      <div className="w-[72%] overflow-hidden rounded-2xl rounded-bl-md border border-white/10 bg-[#182230]">
        <div className="relative h-[130px] bg-[linear-gradient(160deg,#2a3544,#1a2430)]">
          <svg viewBox="0 0 200 110" className="h-full w-full" aria-hidden>
            <rect x="70" y="10" width="18" height="80" rx="4" fill="#6b7785" />
            <rect x="88" y="55" width="40" height="10" rx="3" fill="#7a8694" />
            <ellipse cx="97" cy="78" rx="14" ry="8" fill="#4db8e8" opacity="0.7" />
          </svg>
          <span className="absolute top-2 right-2 rounded bg-black/50 px-2 py-0.5 font-mono text-[11px] text-white/80">
            2:49 PM
          </span>
        </div>
        <p className="px-3.5 py-2.5 text-[15px] font-medium text-green">{label}</p>
      </div>
    </div>
  );
}
