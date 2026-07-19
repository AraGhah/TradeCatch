import { ComponentProps } from "react";
import { Link } from "@/i18n/navigation";

type Variant = "primary" | "secondary" | "ghost";

const styles: Record<Variant, string> = {
  primary:
    "bg-orange text-white hover:bg-orange/90 focus-visible:outline-orange",
  secondary:
    "bg-transparent text-navy border border-navy/20 hover:border-navy/40",
  ghost: "bg-transparent text-blue hover:text-navy underline underline-offset-4",
};

export function CTAButton({
  href,
  variant = "primary",
  className = "",
  children,
  ...props
}: {
  href: ComponentProps<typeof Link>["href"];
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
} & Omit<ComponentProps<typeof Link>, "href">) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded-md px-6 py-3 text-base font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </Link>
  );
}
