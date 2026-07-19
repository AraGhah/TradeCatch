import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Container } from "@/components/Container";
import { CTAButton } from "@/components/CTAButton";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { MobileNav } from "@/components/MobileNav";

export function Header() {
  const t = useTranslations("nav");

  const links: { href: "/services" | "/how-it-works" | "/industries" | "/pricing" | "/about" | "/faq"; label: string }[] = [
    { href: "/services", label: t("services") },
    { href: "/how-it-works", label: t("howItWorks") },
    { href: "/industries", label: t("industries") },
    { href: "/pricing", label: t("pricing") },
    { href: "/about", label: t("about") },
    { href: "/faq", label: t("faq") },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-navy/10 bg-white/95 backdrop-blur">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link href="/" className="text-lg font-bold text-navy font-heading">
          TradeCatch
        </Link>

        <nav className="hidden items-center gap-6 lg:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-text/80 hover:text-navy"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-4 lg:flex">
          <LocaleSwitcher />
          <CTAButton href="/book-audit" className="px-4 py-2 text-sm">
            {t("bookAudit")}
          </CTAButton>
        </div>

        <MobileNav links={links} ctaLabel={t("bookAudit")} />
      </Container>
    </header>
  );
}
