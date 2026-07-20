import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Container } from "@/components/Container";
import { ManageCookiesButton } from "@/components/ManageCookiesButton";

export function Footer() {
  const t = useTranslations("footer");
  const nav = useTranslations("nav");
  const site = useTranslations("site");
  const legal = useTranslations("legal");
  const year = new Date().getFullYear();

  const linkClass = "transition-colors duration-150 hover:text-white";

  return (
    <footer className="border-t border-navy/10 bg-navy text-white/80">
      <Container className="grid gap-10 py-12 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="text-lg font-bold text-white font-heading">TradeCatch</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed">{t("description")}</p>
          <p className="mt-4 text-sm">{site("serviceArea")}</p>
          <p className="mt-1 text-sm">
            <a href={`tel:${site("phoneHref")}`} className={linkClass}>
              {site("phone")}
            </a>
            {" · "}
            <a href={`mailto:${site("email")}`} className={linkClass}>
              {site("email")}
            </a>
          </p>
        </div>

        <div>
          <p className="text-sm font-semibold text-white">{t("company")}</p>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link href="/services" className={linkClass}>{nav("services")}</Link></li>
            <li><Link href="/how-it-works" className={linkClass}>{nav("howItWorks")}</Link></li>
            <li><Link href="/industries" className={linkClass}>{nav("industries")}</Link></li>
            <li><Link href="/pricing" className={linkClass}>{nav("pricing")}</Link></li>
            <li><Link href="/about" className={linkClass}>{nav("about")}</Link></li>
            <li><Link href="/faq" className={linkClass}>{nav("faq")}</Link></li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-semibold text-white">{t("legal")}</p>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link href="/privacy-policy" className={linkClass}>{legal("privacyPolicy.title")}</Link></li>
            <li><Link href="/terms-of-service" className={linkClass}>{legal("termsOfService.title")}</Link></li>
            <li><Link href="/cookie-policy" className={linkClass}>{legal("cookiePolicy.title")}</Link></li>
            <li><Link href="/acceptable-use-policy" className={linkClass}>{legal("acceptableUsePolicy.title")}</Link></li>
            <li><Link href="/accessibility-statement" className={linkClass}>{legal("accessibilityStatement.title")}</Link></li>
            <li>
              <ManageCookiesButton label={t("manageCookies")} className={linkClass} />
            </li>
          </ul>
        </div>
      </Container>

      <div className="border-t border-white/10">
        <Container className="flex flex-col gap-2 py-6 text-xs text-white/70 md:flex-row md:items-center md:justify-between">
          <p>© {year} TradeCatch. {t("rightsReserved")}</p>
          <p className="max-w-2xl">{t("disclaimer")}</p>
        </Container>
      </div>
    </footer>
  );
}
