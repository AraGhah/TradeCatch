"use client";

import { DEMO_DATA } from "../timeline";
import type { SceneProps } from "../DemoVideoExperience";

export function Scene4LeadSummary({ p, copy }: SceneProps) {
  const notifyIn = p >= 0.03;
  const cardIn = p >= 0.12;
  const pulseCall = p >= 0.62;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0c141e]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_30%,rgba(228,118,43,0.12),transparent_45%)]" />

      <div className="relative z-10 w-full max-w-[980px] px-8">
        <div
          className={`mb-4 flex justify-end transition-all duration-300 ${
            notifyIn ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"
          }`}
        >
          <div className="rounded-lg border border-orange/40 bg-orange/15 px-5 py-2.5 text-[17px] font-semibold text-orange">
            {copy.newUrgentLead}
          </div>
        </div>

        <div
          className={`rounded-[22px] border border-white/10 bg-[#121c28] p-8 shadow-[0_40px_70px_-40px_rgba(0,0,0,0.8)] transition-all duration-300 ${
            cardIn ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
          }`}
        >
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[13px] tracking-[0.12em] text-orange uppercase">
                {copy.urgentRunning}
              </p>
              <h2 className="mt-1 font-heading text-[clamp(32px,3.4vw,46px)] font-extrabold tracking-[-0.035em] text-white">
                {DEMO_DATA.customer}
              </h2>
            </div>
            <div className="rounded-md bg-white/5 px-4 py-2.5 text-right">
              <p className="text-[13px] text-white/45">{copy.estValue}</p>
              <p className="font-heading text-[24px] font-extrabold text-white">
                {DEMO_DATA.emergencyRange}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              [copy.issue, copy.issueValue],
              [copy.location, DEMO_DATA.location],
              [copy.status, copy.statusValue],
              [copy.attachment, copy.photoReceived],
            ].map(([k, v]) => (
              <div key={k} className="border-t border-white/10 pt-3">
                <dt className="text-[14px] text-white/45">{k}</dt>
                <dd className="mt-0.5 text-[19px] font-medium text-white">{v}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-7 text-[18px] font-semibold text-white/80">
            {copy.recommended}{" "}
            <span className="text-orange">{copy.callImmediately}</span>
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              tabIndex={-1}
              className={`rounded-md bg-orange px-6 py-3 text-[16px] font-semibold text-navy transition ${
                pulseCall ? "scale-[1.03] shadow-[0_0_0_4px_rgba(228,118,43,0.25)]" : ""
              }`}
            >
              {copy.callCustomer}
            </button>
            <button
              type="button"
              tabIndex={-1}
              className="rounded-md border border-white/15 px-6 py-3 text-[16px] font-medium text-white/80"
            >
              {copy.assignTech}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
