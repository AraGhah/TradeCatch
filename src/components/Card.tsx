"use client";

import { ReactNode } from "react";
import { motion } from "framer-motion";

export function Card({
  title,
  children,
  icon,
}: {
  title: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-navy/10 bg-white p-6 shadow-card transition-shadow duration-200 hover:shadow-card-hover"
    >
      <span className="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-orange transition-transform duration-300 group-hover:scale-x-100" />
      {icon ? (
        <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-blue/10 text-blue transition-colors duration-200 group-hover:bg-orange/15 group-hover:text-orange-dark">
          {icon}
        </span>
      ) : null}
      <h3 className="text-lg font-semibold text-navy">{title}</h3>
      <div className="mt-2 text-sm leading-relaxed text-text/70">{children}</div>
    </motion.div>
  );
}
