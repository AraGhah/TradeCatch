"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ReactNode } from "react";
import { useMounted } from "@/components/motion/useMounted";

export default function Template({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  const prefersReducedMotion = useReducedMotion();

  // The entire page is server-rendered fully visible. This transition is a
  // client-only enhancement layered on top after mount — it must never be
  // the thing that makes page content visible in the first place (SSR,
  // no-JS, print, crawlers, and slow/blocked hydration all depend on this).
  if (!mounted || prefersReducedMotion) {
    return <div>{children}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
