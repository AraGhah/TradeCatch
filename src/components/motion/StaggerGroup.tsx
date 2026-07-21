"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ReactNode } from "react";
import { useMounted } from "@/components/motion/useMounted";

const container = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08 },
  },
};

// Opacity is intentionally never part of these variants. whileInView's
// IntersectionObserver can fail to fire for full-page screenshot tools,
// print, and some crawlers; if it never fires, items just keep their
// resting position instead of staying invisible.
export const staggerItem = {
  hidden: { y: 16 },
  visible: {
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
  },
};

function useProgressiveMotion() {
  const mounted = useMounted();
  const prefersReducedMotion = useReducedMotion();
  return mounted && !prefersReducedMotion;
}

export function StaggerGroup({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const animate = useProgressiveMotion();

  // Same progressive-enhancement rule as Reveal: without JS or with
  // reduced motion, children render plainly and stay fully visible.
  if (!animate) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
      variants={container}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const animate = useProgressiveMotion();

  if (!animate) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div className={className} variants={staggerItem}>
      {children}
    </motion.div>
  );
}
