"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useMounted } from "@/components/motion/useMounted";
import { PhoneMissedIcon, MessageIcon, PinIcon, TechnicianIcon, CheckIcon } from "@/components/icons";

const STEP_ICONS = [PhoneMissedIcon, MessageIcon, PinIcon, TechnicianIcon, TechnicianIcon, CheckIcon];

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.1 } },
};

// Opacity stays out of this variant for the same reason as Reveal/StaggerGroup:
// whileInView's IntersectionObserver isn't guaranteed to fire for full-page
// screenshot tools, print, or some crawlers.
const item = {
  hidden: { x: -12 },
  visible: {
    x: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
  },
};

function Steps({ steps }: { steps: { time: string; text: string }[] }) {
  return (
    <>
      {steps.map((step, i) => {
        const Icon = STEP_ICONS[i] ?? CheckIcon;
        const isLast = i === steps.length - 1;
        return (
          <li key={`${step.time}-${i}`} className="relative">
            <span
              className={`absolute top-0.5 -left-[calc(1.5rem+5px)] flex h-6 w-6 items-center justify-center rounded-full ${
                isLast ? "bg-green/15 text-green" : "bg-blue/10 text-blue"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <p className="text-sm font-semibold text-navy">{step.time}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-text/70">{step.text}</p>
          </li>
        );
      })}
    </>
  );
}

export function ScenarioTimeline({
  label,
  steps,
}: {
  label: string;
  steps: { time: string; text: string }[];
}) {
  const mounted = useMounted();
  const prefersReducedMotion = useReducedMotion();

  if (!mounted || prefersReducedMotion) {
    return (
      <div className="rounded-2xl border border-navy/10 bg-white p-6 shadow-card sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue">{label}</p>
        <ol className="relative mt-6 space-y-6 border-l border-navy/10 pl-6">
          <Steps steps={steps} />
        </ol>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-navy/10 bg-white p-6 shadow-card sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue">{label}</p>
      <motion.ol
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
        variants={container}
        className="relative mt-6 space-y-6 border-l border-navy/10 pl-6"
      >
        {steps.map((step, i) => {
          const Icon = STEP_ICONS[i] ?? CheckIcon;
          const isLast = i === steps.length - 1;
          return (
            <motion.li key={`${step.time}-${i}`} variants={item} className="relative">
              <span
                className={`absolute top-0.5 -left-[calc(1.5rem+5px)] flex h-6 w-6 items-center justify-center rounded-full ${
                  isLast ? "bg-green/15 text-green" : "bg-blue/10 text-blue"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <p className="text-sm font-semibold text-navy">{step.time}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-text/70">{step.text}</p>
            </motion.li>
          );
        })}
      </motion.ol>
    </div>
  );
}
