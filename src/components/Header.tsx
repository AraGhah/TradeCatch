"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { Container } from "@/components/Container";
import { CTAButton } from "@/components/CTAButton";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { MobileNav } from "@/components/MobileNav";
import { BrandLockup } from "@/components/BrandLockup";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

type NavHref =
  | "/services"
  | "/how-it-works"
  | "/industries"
  | "/pricing"
  | "/about"
  | "/faq";

export function Header() {
  const t = useTranslations("nav");
  const cta = useTranslations("cta");
  const site = useTranslations("site");
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 10);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const links: { href: NavHref; label: string }[] = [
    { href: "/services", label: t("services") },
    { href: "/how-it-works", label: t("howItWorks") },
    { href: "/industries", label: t("industries") },
    { href: "/pricing", label: t("pricing") },
    { href: "/about", label: t("about") },
    { href: "/faq", label: t("faq") },
  ];

  const phoneDisplay = site("phone").replace(/-/g, "·");

  return (
    <header
      className={`sticky top-0 z-[60] transition-all duration-300 ${
        scrolled
          ? "border-b border-[rgba(12,20,30,0.10)] bg-[rgba(244,241,236,0.92)] shadow-header"
          : "border-b border-transparent bg-[rgba(244,241,236,0.82)]"
      }`}
      style={{ backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}
    >
      <Container className="flex h-(--header-h) items-center justify-between gap-4">
        <div className="flex h-full w-full items-center justify-between gap-4">
          <Link href="/" className={`rounded-md py-1 ${FOCUS_RING}`}>
            <BrandLockup />
          </Link>

          <nav className="hidden items-center gap-0.5 min-[1080px]:flex">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`group relative rounded-md px-3.5 py-2 text-[14.5px] font-medium transition-colors ${FOCUS_RING} ${
                    active ? "text-navy" : "text-muted hover:text-navy"
                  }`}
                >
                  {link.label}
                  <span
                    className={`absolute inset-x-[14px] bottom-[2px] h-0.5 bg-orange transition-opacity ${
                      active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                  />
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-4 min-[1080px]:flex">
            <a
              href={`tel:${site("phoneHref")}`}
              className={`font-mono text-[13px] font-medium text-navy transition-colors hover:text-ember-text ${FOCUS_RING}`}
            >
              {phoneDisplay}
            </a>
            <LocaleSwitcher />
            <CTAButton href="/book-audit" variant="ink" size="sm">
              {cta("bookAudit")}
            </CTAButton>
          </div>

          <div className="flex items-center gap-2.5 min-[1080px]:hidden">
            <CTAButton href="/book-audit" variant="ink" size="sm" className="!px-3.5 !py-2.5 text-[13px]">
              {cta("bookAuditShort")}
            </CTAButton>
            <MobileNav
              links={links}
              ctaLabel={cta("bookAuditFree")}
              phone={phoneDisplay}
              phoneHref={site("phoneHref")}
            />
          </div>
        </div>
      </Container>
    </header>
  );
}
