"use client";

import { ComponentProps } from "react";
import NextLink from "next/link";
import { Link } from "@/i18n/navigation";
import { trackEvent } from "@/lib/analytics";

/**
 * An anchor link: a localized path with a hash ("/fr/receptionniste#try-it")
 * or a hash on the current page ("#try-it").
 */
export type AnchorHref = `/${string}#${string}` | `#${string}`;

function isAnchorHref(href: unknown): href is AnchorHref {
  return (
    typeof href === "string" &&
    (href.startsWith("#") || (href.startsWith("/") && href.includes("#")))
  );
}

type Variant =
  | "ember"
  | "ink"
  | "ghost"
  | "ghost-ink"
  | "outline"
  | "primary"
  | "secondary"
  | "link"
  | "link-ink";
type Size = "sm" | "md" | "lg";

const styles: Record<string, string> = {
  ember:
    "bg-orange text-navy shadow-cta hover:bg-orange-dark hover:translate-y-[-1px]",
  ink: "bg-navy text-white shadow-[0_8px_20px_-10px_rgb(var(--ink-rgb)/.55)] hover:bg-navy-light hover:translate-y-[-1px]",
  ghost:
    "bg-surface text-heading border-[1.5px] border-[rgb(var(--ink-rgb)/0.16)] hover:border-navy hover:bg-paper",
  "ghost-ink":
    "bg-transparent text-white border border-white/20 hover:bg-white/[0.07] hover:border-white/40",
  outline:
    "bg-transparent text-heading border-[1.5px] border-[rgb(var(--ink-rgb)/0.16)] hover:bg-navy hover:text-white hover:border-navy",
  link: "bg-transparent text-ember-text underline underline-offset-[6px] decoration-[1.5px] decoration-ember-text/40 hover:text-heading hover:decoration-navy px-0 py-0 rounded-none",
  "link-ink":
    "bg-transparent text-white underline underline-offset-[6px] decoration-[1.5px] decoration-orange hover:text-orange px-0 py-0 rounded-none",
};

const sizes: Record<Size, string> = {
  sm: "min-h-11 px-5 py-3 text-[14px] rounded-[var(--radius-md)]",
  md: "min-h-12 px-[22px] py-[14px] text-[15px] rounded-[var(--radius-md)]",
  lg: "min-h-12 px-[26px] py-[17px] text-[16px] rounded-[var(--radius-md)]",
};

/**
 * Map aliases to concrete styles. `secondary` = bordered surface button.
 * `ghost` stays bordered (not a text link) — use `link` / `link-ink` for text.
 */
function resolveVariant(variant: Variant): string {
  if (variant === "primary") return "ember";
  if (variant === "secondary") return "ghost";
  return variant;
}

export function CTAButton({
  href,
  variant = "ember",
  size = "md",
  className = "",
  children,
  onClick,
  ...props
}: {
  href: ComponentProps<typeof Link>["href"] | AnchorHref;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
} & Omit<ComponentProps<typeof Link>, "href">) {
  const styleKey = resolveVariant(variant);
  const isLink = styleKey === "link" || styleKey === "link-ink";

  // tc-cta: a short press (scale) and a nudge of a trailing arrow on hover.
  const classes = `tc-cta inline-flex items-center justify-center gap-2 font-semibold tracking-[-0.01em] transition-[translate,scale,background,border-color,box-shadow,color] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange ${styles[styleKey]} ${isLink ? "" : `${sizes[size]} active:scale-[0.98]`} ${className}`;

  // Anchor links bypass typed locale pathnames (see localizedAnchor).
  if (isAnchorHref(href)) {
    return (
      <NextLink
        href={href}
        onClick={(e) => {
          trackEvent("cta_click", { href, variant });
          onClick?.(e);
        }}
        className={classes}
        {...(props as Omit<ComponentProps<typeof NextLink>, "href">)}
      >
        {children}
      </NextLink>
    );
  }

  return (
    <Link
      href={href}
      onClick={(e) => {
        trackEvent("cta_click", { href: String(href), variant });
        onClick?.(e);
      }}
      className={classes}
      {...props}
    >
      {children}
    </Link>
  );
}
