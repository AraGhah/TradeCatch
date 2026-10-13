"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import { ReactNode } from "react";
import { useMounted } from "@/components/motion/useMounted";

const ease = [0.22, 1, 0.36, 1] as const;

const groupTags = {
  div: motion.div,
  ol: motion.ol,
  ul: motion.ul,
  tbody: motion.tbody,
};

const itemTags = {
  div: motion.div,
  li: motion.li,
  tr: motion.tr,
};

// Opacity is intentionally never part of these variants. whileInView's
// IntersectionObserver can fail to fire for full-page screenshot tools,
// print, and some crawlers; if it never fires, items just keep their
// resting position instead of staying invisible.
export const staggerItem = {
  hidden: { y: 16 },
  visible: {
    y: 0,
    transition: { duration: 0.45, ease },
  },
};

/** Where an item travels in from. "pop" scales up from slightly smaller. */
export type StaggerFrom = "up" | "left" | "right" | "pop";

const itemVariants: Record<StaggerFrom, Variants> = {
  up: staggerItem,
  left: {
    hidden: { x: -14 },
    visible: { x: 0, transition: { duration: 0.45, ease } },
  },
  right: {
    hidden: { x: 14 },
    visible: { x: 0, transition: { duration: 0.45, ease } },
  },
  pop: {
    hidden: { scale: 0.94 },
    visible: {
      scale: 1,
      transition: { type: "spring", stiffness: 320, damping: 22 },
    },
  },
};

export function useProgressiveMotion() {
  const mounted = useMounted();
  const prefersReducedMotion = useReducedMotion();
  return mounted && !prefersReducedMotion;
}

export function StaggerGroup({
  children,
  className = "",
  as = "div",
  stagger = 0.08,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  as?: keyof typeof groupTags;
  /** Seconds between each child's entrance. */
  stagger?: number;
  /** Seconds before the first child starts. */
  delay?: number;
}) {
  const animate = useProgressiveMotion();

  // Same progressive-enhancement rule as Reveal: without JS or with
  // reduced motion, children render plainly and stay fully visible.
  if (!animate) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }

  const MotionTag = groupTags[as];

  return (
    <MotionTag
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: stagger, delayChildren: delay },
        },
      }}
    >
      {children}
    </MotionTag>
  );
}

export function StaggerItem({
  children,
  className = "",
  as = "div",
  from = "up",
}: {
  children: ReactNode;
  className?: string;
  as?: keyof typeof itemTags;
  from?: StaggerFrom;
}) {
  const animate = useProgressiveMotion();

  if (!animate) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }

  const MotionTag = itemTags[as];

  return (
    <MotionTag className={className} variants={itemVariants[from]}>
      {children}
    </MotionTag>
  );
}

const popVariants: Variants = {
  hidden: { scale: 0.6 },
  visible: {
    scale: 1,
    transition: { type: "spring", stiffness: 420, damping: 18, delay: 0.12 },
  },
};

/**
 * Small accent (number badge, check mark, status dot) that springs in when
 * its surrounding StaggerItem enters. It inherits the parent's variant
 * state, so outside an animating StaggerGroup it simply renders at rest.
 */
export function StaggerPop({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <motion.span className={className} variants={popVariants}>
      {children}
    </motion.span>
  );
}
