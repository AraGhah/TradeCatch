"use client";

import { LogoMark } from "@/components/BrandLockup";
import { DEMO_DATA } from "../timeline";
import type { SceneProps } from "../DemoVideoExperience";

export function Scene8Closing({ p, copy }: SceneProps) {
  const show = p >= 0.03;
  const logoPulse = p >= 0.4;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0c141e]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgba(228,118,43,0.14),transparent_55%)]" />

      <div
        className={`relative z-10 mx-auto max-w-[860px] px-8 text-center transition-all duration-300 ${
          show ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
        }`}
      >
        <div
          className={`mb-6 inline-flex items-center gap-3 transition-transform duration-700 ${
            logoPulse ? "scale-105" : "scale-100"
          }`}
        >
          <LogoMark inverted className="!h-14 !w-14 !rounded-[16px]" />
          <span className="font-heading text-[40px] font-extrabold tracking-[-0.04em] text-white">
            TradeCatch
          </span>
        </div>

        <h2 className="font-heading text-[clamp(34px,4.4vw,54px)] leading-[1.05] font-extrabold tracking-[-0.04em] text-white">
          {copy.closingHeadline}
        </h2>
        <p className="mx-auto mt-4 max-w-[34em] text-[clamp(18px,1.7vw,22px)] leading-snug text-white/70">
          {copy.closingSupport}
        </p>
        <p className="mx-auto mt-5 max-w-[30em] text-[18px] text-orange">
          {copy.closingCtaLine}
        </p>

        <a
          href="/book-audit"
          className="mt-7 inline-flex rounded-md bg-orange px-8 py-4 text-[20px] font-semibold text-navy"
        >
          {copy.bookDemo}
        </a>

        {/* One destination to remember; the phone number stays secondary. */}
        <p className="mt-8 font-heading text-[clamp(28px,2.6vw,40px)] font-extrabold tracking-[-0.03em] text-white">
          {DEMO_DATA.contact.website}
        </p>
        <p className="mt-3 font-mono text-[16px] text-white/45">
          {DEMO_DATA.contact.phone}
        </p>
      </div>
    </div>
  );
}
