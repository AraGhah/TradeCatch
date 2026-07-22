"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useMounted } from "@/components/motion/useMounted";
import { PhoneMissedIcon, MessageIcon, TechnicianIcon, CheckIcon } from "@/components/icons";

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.14, delayChildren: 0.15 } },
};

const item = {
  hidden: { y: 10 },
  visible: {
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
  },
};

export function HeroMockup({
  illustrativeLabel,
  missedCallLabel,
  missedCallTime,
  chatTime,
  systemMessage,
  customerReply,
  technicianAlert,
  technicianAlertTime,
  technicianAcceptedLabel,
  dashboardResult,
  dashboardResultTime,
  dashboardMetricValue,
  dashboardMetricLabel,
}: {
  illustrativeLabel: string;
  missedCallLabel: string;
  missedCallTime: string;
  chatTime: string;
  systemMessage: string;
  customerReply: string;
  technicianAlert: string;
  technicianAlertTime: string;
  technicianAcceptedLabel: string;
  dashboardResult: string;
  dashboardResultTime: string;
  dashboardMetricValue: string;
  dashboardMetricLabel: string;
}) {
  const mounted = useMounted();
  const prefersReducedMotion = useReducedMotion();
  const animate = mounted && !prefersReducedMotion;

  const Wrapper = animate ? motion.div : "div";
  const Item = animate ? motion.div : "div";

  return (
    <div className="relative rounded-2xl border border-navy/10 bg-white p-5 shadow-card sm:p-7">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-navy/40">
        {illustrativeLabel}
      </p>
      <Wrapper
        {...(animate ? { initial: "hidden", animate: "visible", variants: container } : {})}
        className="relative mt-5 space-y-6 border-l border-navy/10 pl-7"
      >
        <Item {...(animate ? { variants: item } : {})} className="relative">
          <span className="absolute top-0.5 -left-[calc(1.75rem+1px)] flex h-8 w-8 items-center justify-center rounded-full bg-orange/15 text-orange-dark">
            <PhoneMissedIcon className="h-4 w-4" />
          </span>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-navy/10 bg-bg px-4 py-3">
            <p className="text-sm font-semibold text-navy">{missedCallLabel}</p>
            <p className="shrink-0 text-xs text-text/60">{missedCallTime}</p>
          </div>
        </Item>

        <Item {...(animate ? { variants: item } : {})} className="relative">
          <span className="absolute top-0.5 -left-[calc(1.75rem+1px)] flex h-8 w-8 items-center justify-center rounded-full bg-blue/10 text-blue">
            <MessageIcon className="h-4 w-4" />
          </span>
          <p className="mb-2 text-xs text-text/50">{chatTime}</p>
          <div className="flex flex-col gap-2">
            <p className="max-w-[85%] rounded-2xl rounded-tl-sm bg-blue/10 px-3.5 py-2 text-xs leading-relaxed text-navy">
              {systemMessage}
            </p>
            <p className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-navy px-3.5 py-2 text-xs leading-relaxed text-white">
              {customerReply}
            </p>
          </div>
        </Item>

        <Item {...(animate ? { variants: item } : {})} className="relative">
          <span className="absolute top-0.5 -left-[calc(1.75rem+1px)] flex h-8 w-8 items-center justify-center rounded-full bg-blue/10 text-blue">
            <TechnicianIcon className="h-4 w-4" />
          </span>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-navy/10 bg-bg px-4 py-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-navy">{technicianAlert}</p>
              <span className="shrink-0 rounded-full bg-green/15 px-2 py-0.5 text-[11px] font-semibold text-green">
                {technicianAcceptedLabel}
              </span>
            </div>
            <p className="shrink-0 text-xs text-text/60">{technicianAlertTime}</p>
          </div>
        </Item>

        <Item {...(animate ? { variants: item } : {})} className="relative">
          <span className="absolute top-0.5 -left-[calc(1.75rem+1px)] flex h-8 w-8 items-center justify-center rounded-full bg-green/15 text-green">
            <CheckIcon className="h-4 w-4" />
          </span>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-green/20 bg-green/5 px-4 py-3">
            <p className="text-sm font-semibold text-navy">{dashboardResult}</p>
            <p className="shrink-0 text-xs text-text/60">{dashboardResultTime}</p>
          </div>
          <div className="mt-3 flex items-baseline gap-2 rounded-xl border border-navy/10 bg-white px-4 py-3">
            <span className="text-xl font-bold text-navy">{dashboardMetricValue}</span>
            <span className="text-xs leading-snug text-text/60">{dashboardMetricLabel}</span>
          </div>
        </Item>
      </Wrapper>
    </div>
  );
}
