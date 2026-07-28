"use client";

import type { ReactNode } from "react";
import { DEMO_DATA, type DemoCopy } from "../timeline";
import type { SceneProps } from "../DemoVideoExperience";

export function Scene6EstimateFollowUp({ p, copy }: SceneProps) {
  const followSent = p >= 0.18;
  const reply = p >= 0.46;
  const reactivated = p >= 0.68;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0c141e]">
      <div className="relative z-10 w-full max-w-[1120px] px-8">
        <p className="mb-4 font-mono text-[13px] tracking-[0.14em] text-white/45 uppercase">
          {copy.estimatePipeline}
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <PipelineColumn title={copy.awaiting} active={!reactivated} dim={reactivated}>
            {!reactivated ? (
              <EstimateCard copy={copy} followSent={followSent} reply={reply} />
            ) : (
              <p className="px-3 py-7 text-center text-[15px] text-white/35">{copy.moved}</p>
            )}
          </PipelineColumn>

          <PipelineColumn title={copy.reactivated} active={reactivated} highlight>
            {reactivated ? (
              <EstimateCard copy={copy} followSent reply reactivated />
            ) : (
              <p className="px-3 py-7 text-center text-[15px] text-white/25">—</p>
            )}
          </PipelineColumn>
        </div>

        {(followSent || reply) && (
          <div className="mt-5 space-y-2.5 rounded-[14px] border border-white/10 bg-[#121c28] p-5">
            {followSent ? (
              <p className="text-[17px] leading-snug text-white/85">
                <span className="mr-2 text-[13px] font-semibold tracking-wide text-orange uppercase">
                  {copy.followUp}
                </span>
                {copy.followUpMsg}
              </p>
            ) : null}
            {reply ? (
              <p className="rounded-lg bg-white/[0.04] px-4 py-2.5 text-[17px] text-white/80">
                <span className="mr-2 text-[13px] font-semibold tracking-wide text-green uppercase">
                  {copy.reply}
                </span>
                {copy.replyMsg}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function PipelineColumn({
  title,
  children,
  active,
  dim,
  highlight,
}: {
  title: string;
  children: ReactNode;
  active: boolean;
  dim?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-[16px] border p-5 transition-all duration-300 ${
        highlight && active ? "border-green/40 bg-green/10" : "border-white/10 bg-[#121c28]"
      } ${dim ? "opacity-40" : "opacity-100"}`}
    >
      <p className="mb-3 text-[16px] font-semibold text-white/70">{title}</p>
      {children}
    </div>
  );
}

function EstimateCard({
  copy,
  followSent,
  reply,
  reactivated,
}: {
  copy: DemoCopy;
  followSent: boolean;
  reply: boolean;
  reactivated?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0e1620] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[21px] font-semibold text-white">{DEMO_DATA.secondaryCustomer}</p>
          <p className="mt-0.5 text-[15px] text-white/55">{copy.basementProject}</p>
        </div>
        <p className="font-heading text-[24px] font-extrabold text-orange">
          {DEMO_DATA.secondaryValue}
        </p>
      </div>
      <p className="mt-3 text-[14px] text-white/45">{copy.sentThreeDays}</p>
      <p
        className={`mt-2 text-[16px] font-semibold ${
          reactivated ? "text-green" : followSent ? "text-orange" : "text-white/50"
        }`}
      >
        {reactivated
          ? copy.reactivated
          : reply
            ? copy.customerReplied
            : followSent
              ? copy.followUpSent
              : copy.awaiting}
      </p>
    </div>
  );
}
