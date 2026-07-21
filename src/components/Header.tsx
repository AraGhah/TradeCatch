"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { Container } from "@/components/Container";
import { CTAButton } from "@/components/CTAButton";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { MobileNav } from "@/components/MobileNav";
import { CheckIcon, PhoneIcon } from "@/components/icons";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

type NavHref =
  | "/services"
  | "/how-it-works"
  | "/industries"
  | "/pricing"
  | "/about"
  | "/faq";

export function Header() {
  const t = useTranslations("nav");
  const site = useTranslations("site");
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links: { href: NavHref; label: string }[] = [
    { href: "/services", label: t("services") },
    { href: "/how-it-works", label: t("howItWorks") },
    { href: "/industries", label: t("industries") },
    { href: "/pricing", label: t("pricing") },
    { href: "/about", label: t("about") },
    { href: "/faq", label: t("faq") },
  ];

  return (
    <header
      className={`sticky top-0 z-40 border-b bg-white/95 backdrop-blur transition-all duration-300 ${
        scrolled
          ? "border-navy/10 shadow-[0_2px_16px_rgba(18,32,51,0.06)]"
          : "border-transparent"
      }`}
    >
      <Container
        className={`flex items-center justify-between gap-4 transition-[height] duration-300 ${
          scrolled ? "h-16 lg:h-16" : "h-16 lg:h-20"
        }`}
      >
        <Link
          href="/"
          className={`flex items-center gap-2.5 rounded-md py-1 transition-opacity hover:opacity-85 ${FOCUS_RING}`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy text-white">
            <CheckIcon className="h-4 w-4" />
          </span>
          <span className="font-heading text-lg font-bold tracking-tight text-navy">
            TradeCatch
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`group relative rounded-md px-3 py-2 text-sm font-medium transition-colors ${FOCUS_RING} ${
                  active ? "text-navy" : "text-text/70 hover:text-navy"
                }`}
              >
                {link.label}
                <span
                  className={`absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-orange transition-transform duration-200 ${
                    active
                      ? "scale-x-100"
                      : "scale-x-0 group-hover:scale-x-100"
                  }`}
                />
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-5 lg:flex">
          <a
            href={`tel:${site("phoneHref")}`}
            className={`flex items-center gap-2 rounded-md py-1 text-sm font-semibold text-navy transition-colors hover:text-blue ${FOCUS_RING}`}
          >
            <PhoneIcon className="h-4 w-4 text-orange-dark" />
            {site("phone")}
          </a>
          <LocaleSwitcher />
          <CTAButton href="/book-audit" size="sm">
            {t("bookAudit")}
          </CTAButton>
        </div>

        <MobileNav
          links={links}
          ctaLabel={t("bookAudit")}
          phone={site("phone")}
          phoneHref={site("phoneHref")}
        />
      </Container>
    </header>
  );
}
