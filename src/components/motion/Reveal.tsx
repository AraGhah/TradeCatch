"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ReactNode } from "react";
import { useMounted } from "@/components/motion/useMounted";

export function Reveal({
  children,
  delay = 0,
  className = "",
  as = "div",
  id,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section";
  id?: string;
}) {
  const mounted = useMounted();
  const prefersReducedMotion = useReducedMotion();

  // Content is visible by default (SSR, no-JS, print, crawlers, and the
  // instant before hydration). The animated, JS-only entrance only ever
  // enhances already-visible content once mounted and motion is allowed.
  if (!mounted || prefersReducedMotion) {
    const Tag = as;
    return (
      <Tag id={id} className={className}>
        {children}
      </Tag>
    );
  }

  const MotionTag = as === "section" ? motion.section : motion.div;

  // Opacity is never part of this animation: only the transform moves.
  // whileInView's IntersectionObserver can legitimately fail to fire for
  // full-page screenshot tools, print, and some crawlers that never
  // trigger a real scroll/resize — if that happens here, content simply
  // sits at its final position instead of vanishing.
  return (
    <MotionTag
      id={id}
      className={className}
      initial={{ y: 20 }}
      whileInView={{ y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </MotionTag>
  );
}
