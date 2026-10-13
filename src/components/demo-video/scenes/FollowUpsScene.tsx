"use client";

import { DEMO_DATA } from "../timeline";
import { Panel, reveal } from "../parts/sceneKit";
import type { SceneProps } from "../DemoVideoExperience";

/** Both automations in one beat: missed-call text-back and quote follow-up. */
export function FollowUpsScene({ p, copy }: SceneProps) {
  const headlineIn = p >= 0.02;
  const missedIn = p >= 0.1;
  const missedSms = p >= 0.14;
  const quoteIn = p >= 0.38;
  const quoteSms = p >= 0.46;
  const stopsIn = p >= 0.62;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0c141e]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_10%,rgba(228,118,43,0.12),transparent_50%)]" />

      <div className="relative z-10 w-full max-w-[1240px] -translate-y-[5vh] px-10">
        <h2
          className={`text-center font-heading text-[clamp(34px,3.6vw,52px)] font-extrabold tracking-[-0.04em] text-white ${reveal(headlineIn)}`}
        >
          {copy.followUpsHeadline}
        </h2>

        <div className="mt-10 grid grid-cols-2 gap-7">
          <Panel className={`p-7 ${reveal(missedIn, "left")}`}>
            <p className="text-[14px] font-semibold tracking-[0.12em] text-orange uppercase">
              {copy.missedTextBack}
            </p>
            <p className="mt-2 text-[20px] font-semibold text-white">
              {DEMO_DATA.customer}
            </p>
            <div className={`mt-5 ${reveal(missedSms)}`}>
              <p className="rounded-2xl rounded-br-md bg-[#1e6b47] px-5 py-4 text-[20px] leading-snug text-white">
                {copy.textBackSms}
              </p>
              <p className="mt-2 text-right text-[14px] text-white/50">
                {copy.sentAutomatically}
              </p>
            </div>
          </Panel>

          <Panel className={`p-7 ${reveal(quoteIn, "right")}`}>
            <p className="text-[14px] font-semibold tracking-[0.12em] text-orange uppercase">
              {copy.quoteFollowUpDay}
            </p>
            <p className="mt-2 text-[20px] font-semibold text-white">
              {DEMO_DATA.secondaryCustomer} · {DEMO_DATA.secondaryValue}
            </p>
            <div className={`mt-5 ${reveal(quoteSms)}`}>
              <p className="rounded-2xl rounded-br-md bg-[#1e6b47] px-5 py-4 text-[20px] leading-snug text-white">
                {copy.followUpMsg}
              </p>
              <p
                className={`mt-2 text-right text-[14px] font-semibold text-green ${reveal(stopsIn)}`}
              >
                {copy.replyStops}
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
