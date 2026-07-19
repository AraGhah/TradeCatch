"use client";

import { motion } from "framer-motion";

export function NumberedStep({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.4, delay: (index % 2) * 0.08 }}
      className="group flex gap-4"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-bold text-white shadow-sm transition-transform duration-200 group-hover:scale-110 group-hover:bg-orange group-hover:text-navy">
        {index}
      </span>
      <div>
        <h3 className="font-semibold text-navy">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-text/70">{children}</p>
      </div>
    </motion.div>
  );
}
