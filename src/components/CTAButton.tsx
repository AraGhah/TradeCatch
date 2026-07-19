"use client";

import { ComponentProps } from "react";
import { motion } from "framer-motion";
import { Link } from "@/i18n/navigation";
import { trackEvent } from "@/lib/analytics";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const styles: Record<Variant, string> = {
  primary:
    "bg-orange text-navy shadow-cta hover:bg-orange-dark hover:shadow-lg",
  secondary:
    "bg-white text-navy border-2 border-navy/15 hover:border-blue hover:text-blue",
  ghost:
    "bg-transparent text-blue hover:text-navy underline underline-offset-4 decoration-blue/40 hover:decoration-navy",
};

const sizes: Record<Size, string> = {
  sm: "px-4 py-2 text-sm",
  md: "px-6 py-3 text-base",
  lg: "px-8 py-4 text-lg",
};

export function CTAButton({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
  onClick,
  ...props
}: {
  href: ComponentProps<typeof Link>["href"];
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
} & Omit<ComponentProps<typeof Link>, "href">) {
  return (
    <motion.span
      className="inline-block"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.15 }}
    >
      <Link
        href={href}
        onClick={(e) => {
          trackEvent("cta_click", { href: String(href), variant });
          onClick?.(e);
        }}
        className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 ${styles[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {children}
      </Link>
    </motion.span>
  );
}
