"use client";

import { DEMO_DATA } from "../timeline";
import { SmartphoneFrame } from "../parts/SmartphoneFrame";
import type { SceneProps } from "../DemoVideoExperience";

export function Scene5Appointment({ p, copy }: SceneProps) {
  const selected = p >= 0.06;
  const flying = p >= 0.16 && p < 0.34;
  const onCalendar = p >= 0.3;
  const showPhone = p >= 0.48;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0c141e]">
      <div className="relative z-10 flex w-full max-w-[1240px] items-center justify-center gap-10 px-8">
        <div
          className={`w-full transition-all duration-300 ${
            showPhone ? "max-w-[620px] opacity-50" : "max-w-[780px] opacity-100"
          }`}
        >
          <div className="rounded-[18px] border border-white/10 bg-[#121c28] p-9">
            <p className="font-mono text-[15px] tracking-[0.12em] text-white/45 uppercase">
              {copy.bookAppt}
            </p>
            <p className="mt-2 text-[30px] font-semibold text-white">{DEMO_DATA.customer}</p>

            <div className="mt-6 grid grid-cols-2 gap-4">
              <div
                className={`rounded-lg border px-5 py-4 ${
                  selected ? "border-orange bg-orange/15" : "border-white/10"
                }`}
              >
                <p className="text-[16px] text-white/50">{copy.day}</p>
                <p className="text-[23px] font-semibold text-white">{copy.today}</p>
              </div>
              <div
                className={`rounded-lg border px-5 py-4 ${
                  selected ? "border-orange bg-orange/15" : "border-white/10"
                }`}
              >
                <p className="text-[16px] text-white/50">{copy.window}</p>
                <p className="text-[23px] font-semibold text-white">{copy.windowValue}</p>
              </div>
            </div>

            <div className="relative mt-6 h-[170px] rounded-lg border border-white/10 bg-[#0e1620] p-5">
              <p className="mb-2 text-[15px] text-white/40">{copy.todaysSchedule}</p>
              <div className="grid grid-cols-4 gap-2 text-center text-[15px] text-white/35">
                {["1pm", "2pm", "3pm", "4pm"].map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              <div
                className={`absolute top-[78px] left-[52%] h-[64px] w-[42%] rounded-md bg-orange/90 px-3 py-2.5 text-[17px] font-semibold text-navy transition-all duration-300 ${
                  onCalendar
                    ? "translate-y-0 opacity-100"
                    : flying
                      ? "-translate-y-6 opacity-80"
                      : "translate-y-4 opacity-0"
                }`}
              >
                Sarah · Leak
              </div>
            </div>
          </div>
        </div>

        {showPhone ? (
          <div className="shrink-0 animate-[fade-rise_0.35s_ease-out]">
            <SmartphoneFrame title={copy.companyTitle} statusTime="3:02">
              <div className="flex h-full flex-col gap-3 bg-[#101820] px-4 py-4">
                <div className="ml-5 rounded-2xl rounded-br-md bg-[#1e6b47] px-4 py-3.5 text-[20px] leading-snug text-white">
                  {copy.confirmSms}
                </div>
                <div className="mx-auto mt-2 rounded-full bg-green/20 px-5 py-2 text-[16px] font-semibold text-green">
                  {copy.confirmed}
                </div>
              </div>
            </SmartphoneFrame>
          </div>
        ) : null}
      </div>
    </div>
  );
}
