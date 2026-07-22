"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useMounted } from "@/components/motion/useMounted";
import {
  PhoneMissedIcon,
  MessageIcon,
  AlertIcon,
  QuoteIcon,
  FollowUpIcon,
  CheckIcon,
} from "@/components/icons";

const STEP_ICONS = [
  PhoneMissedIcon,
  MessageIcon,
  AlertIcon,
  QuoteIcon,
  FollowUpIcon,
  CheckIcon,
];

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};

const item = {
  hidden: { opacity: 0, scale: 0.85, y: 10 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
  },
};

function StepList({ labels }: { labels: string[] }) {
  return (
    <>
      {labels.map((label, i) => {
        const Icon = STEP_ICONS[i] ?? CheckIcon;
        const isLast = i === labels.length - 1;
        return (
          <span
            key={label}
            className="relative flex flex-1 items-center gap-3 md:flex-col md:items-center md:text-center"
          >
            <span
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full shadow-sm ${
                isLast ? "bg-green/15 text-green" : "bg-blue/10 text-blue"
              }`}
            >
              <Icon className="h-5 w-5" />
            </span>
            <span className="text-base font-medium text-text">{label}</span>
            {!isLast ? (
              <span
                aria-hidden
                className="absolute top-6 left-[calc(50%+32px)] hidden h-px w-[calc(100%-40px)] bg-gradient-to-r from-navy/20 to-navy/5 md:block"
              />
            ) : null}
          </span>
        );
      })}
    </>
  );
}

export function WorkflowDiagram({ caption }: { caption: string }) {
  const labels = caption.split("→").map((s) => s.trim());
  const mounted = useMounted();
  const prefersReducedMotion = useReducedMotion();

  // Content is visible by default; the staggered entrance only ever
  // enhances an already-visible diagram once JS has mounted and motion
  // is allowed. See Reveal.tsx for the same progressive-enhancement rule.
  if (!mounted || prefersReducedMotion) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-navy/10 bg-white p-6 shadow-card sm:p-8">
        <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-navy" />
        <ol className="relative flex flex-col gap-5 md:flex-row md:items-start md:justify-between md:gap-2">
          <StepList labels={labels} />
        </ol>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="relative overflow-hidden rounded-2xl border border-navy/10 bg-white p-6 shadow-card sm:p-8"
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-navy" />
      <motion.ol
        initial="hidden"
        animate="visible"
        variants={container}
        className="relative flex flex-col gap-5 md:flex-row md:items-start md:justify-between md:gap-2"
      >
        {labels.map((label, i) => {
          const Icon = STEP_ICONS[i] ?? CheckIcon;
          const isLast = i === labels.length - 1;
          return (
            <motion.li
              key={label}
              variants={item}
              className="relative flex flex-1 items-center gap-3 md:flex-col md:items-center md:text-center"
            >
              <span
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full shadow-sm ${
                  isLast ? "bg-green/15 text-green" : "bg-blue/10 text-blue"
                }`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-base font-medium text-text">{label}</span>
              {!isLast ? (
                <span
                  aria-hidden
                  className="absolute top-6 left-[calc(50%+32px)] hidden h-px w-[calc(100%-40px)] bg-gradient-to-r from-navy/20 to-navy/5 md:block"
                />
              ) : null}
            </motion.li>
          );
        })}
      </motion.ol>
    </motion.div>
  );
}
