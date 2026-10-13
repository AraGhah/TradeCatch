"use client";

import { DEMO_DATA } from "../timeline";
import { Avatar, Panel, reveal } from "../parts/sceneKit";
import type { SceneProps } from "../DemoVideoExperience";

/** The text-back thread becomes an organized lead, and the owner is told. */
export function LeadCapturedScene({ p, copy }: SceneProps) {
  const toastIn = p >= 0.03;
  const cardIn = p >= 0.1;
  const threadIn = p >= 0.3;
  const notified = p >= 0.55;
  const pulseCall = p >= 0.68;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0c141e]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_30%,rgba(228,118,43,0.12),transparent_45%)]" />

      <div className="relative z-10 w-full max-w-[1100px] -translate-y-[4vh] px-10">
        <div className={`mb-5 flex justify-end ${reveal(toastIn, "right")}`}>
          <div className="rounded-xl border border-orange/40 bg-orange/15 px-5 py-3 text-[18px] font-semibold text-orange">
            {copy.newLeadCaptured}
          </div>
        </div>

        <Panel className={`p-8 ${reveal(cardIn)}`}>
          <div className="flex items-center gap-5">
            <Avatar initials="SM" size={64} />
            <div className="flex-1">
              <h2 className="font-heading text-[clamp(32px,3.2vw,44px)] font-extrabold tracking-[-0.035em] text-white">
                {DEMO_DATA.customer}
              </h2>
              <p className="text-[17px] text-white/55">{copy.leadSourceMissed}</p>
            </div>
            <span
              className={`rounded-full bg-green/15 px-4 py-2 text-[16px] font-semibold text-green ${reveal(notified, "right")}`}
            >
              ✓ {copy.ownerNotified}
            </span>
          </div>

          <div className="mt-6 grid grid-cols-[1fr_1fr] gap-6">
            <dl className="space-y-3">
              {[
                [copy.issue, copy.valueService],
                [copy.location, DEMO_DATA.location],
                [copy.status, copy.statusReplied],
              ].map(([label, value]) => (
                <div key={label} className="border-t border-white/10 pt-3">
                  <dt className="text-[14px] text-white/45">{label}</dt>
                  <dd className="mt-0.5 text-[19px] font-medium text-white">{value}</dd>
                </div>
              ))}
            </dl>

            <div className={`rounded-xl bg-white/[0.04] p-5 ${reveal(threadIn)}`}>
              <p className="text-[13px] font-semibold tracking-[0.1em] text-white/45 uppercase">
                {copy.conversation}
              </p>
              <p className="mt-3 ml-6 rounded-2xl rounded-br-md bg-[#1e6b47] px-4 py-3 text-[16px] leading-snug text-white">
                {copy.textBackSms}
              </p>
              <p className="mt-2.5 mr-6 rounded-2xl rounded-bl-md bg-[#1c2734] px-4 py-3 text-[16px] leading-snug text-white/90">
                {copy.textBackReply}
              </p>
            </div>
          </div>

          <div className="mt-6">
            <span
              className={`inline-flex rounded-lg bg-orange px-6 py-3 text-[17px] font-semibold text-navy transition-all duration-300 ${
                pulseCall ? "scale-[1.04] shadow-[0_0_0_5px_rgba(228,118,43,0.25)]" : ""
              }`}
            >
              {copy.callCustomer}
            </span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
