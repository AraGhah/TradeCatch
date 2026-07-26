"use client";

import { ComponentProps } from "react";
import { Link } from "@/i18n/navigation";
import { trackEvent } from "@/lib/analytics";

type Variant = "ember" | "ink" | "ghost" | "ghost-ink" | "outline" | "primary" | "secondary" | "link";
type Size = "sm" | "md" | "lg";

const styles: Record<string, string> = {
  ember:
    "bg-orange text-navy shadow-cta hover:bg-orange-dark hover:translate-y-[-2px]",
  ink: "bg-navy text-white shadow-[0_8px_20px_-10px_rgba(12,20,30,.6)] hover:bg-navy-light hover:translate-y-[-1px]",
  ghost:
    "bg-white text-navy border-[1.5px] border-[rgba(12,20,30,0.16)] hover:border-navy hover:translate-y-[-2px]",
  "ghost-ink":
    "bg-transparent text-white border border-white/20 hover:bg-white/[0.07] hover:border-white/40",
  outline:
    "bg-transparent text-navy border-[1.5px] border-[rgba(12,20,30,0.16)] w-full hover:bg-navy hover:text-white hover:border-navy",
  link: "bg-transparent text-ember-text underline underline-offset-[6px] decoration-[1.5px] decoration-ember-text/40 hover:text-navy hover:decoration-navy px-0 py-0 rounded-none",
};

const sizes: Record<Size, string> = {
  sm: "px-5 py-3 text-[14px] rounded-[10px]",
  md: "px-[22px] py-[14px] text-[15px] rounded-[11px]",
  lg: "px-[26px] py-[17px] text-[16.5px] rounded-[12px]",
};

function resolveVariant(variant: Variant): string {
  if (variant === "primary") return "ember";
  if (variant === "secondary") return "ghost";
  if (variant === "ghost") return "link";
  return variant;
}

export function CTAButton({
  href,
  variant = "ember",
  size = "md",
  className = "",
  children,
  onClick,
  showDot = false,
  ...props
}: {
  href: ComponentProps<typeof Link>["href"];
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
  showDot?: boolean;
} & Omit<ComponentProps<typeof Link>, "href">) {
  const styleKey = resolveVariant(variant);
  const isLink = styleKey === "link";
  const withDot = showDot || styleKey === "ink";

  return (
    <Link
      href={href}
      onClick={(e) => {
        trackEvent("cta_click", { href: String(href), variant });
        onClick?.(e);
      }}
      className={`inline-flex items-center justify-center gap-2.5 font-semibold tracking-[-0.01em] transition-[transform,background,border-color,box-shadow,color] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 ${styles[styleKey]} ${isLink ? "" : sizes[size]} ${className}`}
      {...props}
    >
      {children}
      {withDot ? (
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-orange"
        />
      ) : null}
    </Link>
  );
}
