"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ReactNode } from "react";
import { useMounted } from "@/components/motion/useMounted";

const ease = [0.22, 1, 0.36, 1] as const;

const container = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.09, delayChildren: 0.06 },
  },
};

/** Transform-only — never opacity (screenshot/print/crawler safety). */
const item = {
  hidden: { y: 22 },
  visible: {
    y: 0,
    transition: { duration: 0.55, ease },
  },
};

/**
 * Staggered hero copy entrance. Progressive: SSR/no-JS/reduced-motion
 * render children plainly at rest.
 */
export function HeroEntrance({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const mounted = useMounted();
  const prefersReducedMotion = useReducedMotion();

  if (!mounted || prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={container}
    >
      {children}
    </motion.div>
  );
}

export function HeroEntranceItem({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const mounted = useMounted();
  const prefersReducedMotion = useReducedMotion();

  if (!mounted || prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  );
}
