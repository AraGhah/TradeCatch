"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useMounted } from "@/components/motion/useMounted";

export function NumberedStep({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
}) {
  const mounted = useMounted();
  const prefersReducedMotion = useReducedMotion();

  const badge = (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-bold text-white shadow-sm transition-transform duration-200 group-hover:scale-110 group-hover:bg-orange group-hover:text-navy">
      {index}
    </span>
  );
  const body = (
    <div>
      <h3 className="font-semibold text-navy">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-text/70">{children}</p>
    </div>
  );

  if (!mounted || prefersReducedMotion) {
    return (
      <div className="group flex gap-4">
        {badge}
        {body}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ y: 12 }}
      whileInView={{ y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.4, delay: (index % 2) * 0.08 }}
      className="group flex gap-4"
    >
      {badge}
      {body}
    </motion.div>
  );
}
