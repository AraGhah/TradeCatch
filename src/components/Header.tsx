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
import { EmailContactLink } from "@/components/EmailContactLink";
import { AccountLink } from "@/components/AccountLink";
import { useAccountNav } from "@/components/useAccountNav";
import { LinkPendingHint } from "@/components/ui/LinkPendingHint";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

// Header = the pages that sell. About, FAQ, Help and Receptionist live in the
// footer so no page is linked from both places on desktop. Mobile drawer is a
// shorter conversion path (demo / pricing / FAQ), ending in the account entry
// (login or dashboard), which is not a fixed link: see useAccountNav.
type DesktopNavHref =
  | "/services"
  | "/how-it-works"
  | "/industries"
  | "/pricing"
  | "/referral";

type MobileNavHref = "/how-it-works" | "/receptionist" | "/pricing" | "/faq";

export function Header() {
  const t = useTranslations("nav");
  const cta = useTranslations("cta");
  const site = useTranslations("site");
  const pathname = usePathname();
  const account = useAccountNav();
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

  const links: { href: DesktopNavHref; label: string }[] = [
    { href: "/services", label: t("services") },
    { href: "/how-it-works", label: t("howItWorks") },
    { href: "/industries", label: t("industries") },
    { href: "/pricing", label: t("pricing") },
    { href: "/referral", label: t("referral") },
  ];

  const mobileLinks: { href: MobileNavHref; label: string }[] = [
    { href: "/how-it-works", label: t("howItWorks") },
    { href: "/receptionist", label: t("demo") },
    { href: "/pricing", label: t("pricing") },
    { href: "/faq", label: t("faq") },
  ];

  return (
    <header
      className={`sticky top-0 z-[60] transition-[background-color,border-color,box-shadow] duration-300 ${
        scrolled
          ? "border-b border-[rgb(var(--ink-rgb)/0.10)] bg-[rgb(var(--paper-rgb)/0.92)] shadow-header"
          : "border-b border-transparent bg-[rgb(var(--paper-rgb)/0.82)]"
      }`}
      style={{ backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}
    >
      <Container className="flex h-(--header-h) items-center justify-between gap-4">
        <div className="flex h-full w-full items-center justify-between gap-4 max-[420px]:gap-2">
          <Link href="/" className={`flex items-center rounded-md py-2.5 font-heading ${FOCUS_RING}`}>
            <BrandLockup />
          </Link>

          <nav className="hidden items-center gap-1.5 min-[1080px]:flex">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex items-center rounded-md px-3.5 py-2.5 text-[14.5px] font-medium whitespace-nowrap transition-colors ${FOCUS_RING} ${
                    active ? "text-heading" : "text-muted hover:text-heading"
                  }`}
                >
                  {link.label}
                  <LinkPendingHint />
                  <span
                    className={`absolute inset-x-[14px] bottom-[2px] h-0.5 origin-left bg-orange transition-[scale] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
                    }`}
                  />
                </Link>
              );
            })}
          </nav>

          {/* One cluster at every width, so there is exactly one profile icon:
              the last item on desktop, between the demo button and the menu on phones.
              The icon takes 52px of a phone header that had little to spare, so the small
              demo button stays on ONE line by giving way in steps (never a two-line pill):
              420px and up is the original look plus the icon; 385-419px has slightly
              tighter spacing and a slightly smaller button; below 385px the button leaves
              the bar (the menu still has the full-width one). */}
          <div className="flex items-center gap-2.5 max-[420px]:gap-1.5 min-[1080px]:gap-4">
            <div className="hidden items-center gap-4 min-[1080px]:flex">
              <EmailContactLink
                email={site("email")}
                className={`flex items-center rounded-md px-1 py-2.5 text-[14px] font-medium text-heading transition-colors hover:text-ember-text ${FOCUS_RING}`}
              >
                {t("emailUs")}
              </EmailContactLink>
              <LocaleSwitcher />
              <CTAButton href="/book-audit" variant="ink" size="sm">
                {cta("bookFreeDemo")}
              </CTAButton>
            </div>

            <CTAButton
              href="/book-audit"
              variant="ink"
              size="sm"
              className="whitespace-nowrap !px-3.5 !py-2.5 text-[13px] max-[420px]:!px-2.5 max-[420px]:text-[12px] max-[385px]:hidden min-[1080px]:hidden"
            >
              {cta("bookAuditShort")}
            </CTAButton>

            <AccountLink account={account} />

            <div className="min-[1080px]:hidden">
              <MobileNav
                links={mobileLinks}
                account={account}
                ctaLabel={cta("bookFreeDemo")}
                email={site("email")}
                emailLabel={t("emailUs")}
              />
            </div>
          </div>
        </div>
      </Container>
    </header>
  );
}
