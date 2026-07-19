import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Container } from "@/components/Container";

export function Footer() {
  const t = useTranslations("footer");
  const nav = useTranslations("nav");
  const site = useTranslations("site");
  const legal = useTranslations("legal");
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-navy/10 bg-navy text-white/80">
      <Container className="grid gap-10 py-12 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="text-lg font-bold text-white font-heading">TradeCatch</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed">{t("description")}</p>
          <p className="mt-4 text-sm">{site("serviceArea")}</p>
          <p className="mt-1 text-sm">
            <a href={`tel:${site("phoneHref")}`} className="hover:text-white">
              {site("phone")}
            </a>
            {" · "}
            <a href={`mailto:${site("email")}`} className="hover:text-white">
              {site("email")}
            </a>
          </p>
        </div>

        <div>
          <p className="text-sm font-semibold text-white">{t("company")}</p>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link href="/services" className="hover:text-white">{nav("services")}</Link></li>
            <li><Link href="/how-it-works" className="hover:text-white">{nav("howItWorks")}</Link></li>
            <li><Link href="/industries" className="hover:text-white">{nav("industries")}</Link></li>
            <li><Link href="/pricing" className="hover:text-white">{nav("pricing")}</Link></li>
            <li><Link href="/about" className="hover:text-white">{nav("about")}</Link></li>
            <li><Link href="/faq" className="hover:text-white">{nav("faq")}</Link></li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-semibold text-white">{t("legal")}</p>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link href="/privacy-policy" className="hover:text-white">{legal("privacyPolicy.title")}</Link></li>
            <li><Link href="/terms-of-service" className="hover:text-white">{legal("termsOfService.title")}</Link></li>
            <li><Link href="/cookie-policy" className="hover:text-white">{legal("cookiePolicy.title")}</Link></li>
          </ul>
        </div>
      </Container>

      <div className="border-t border-white/10">
        <Container className="flex flex-col gap-2 py-6 text-xs text-white/60 md:flex-row md:items-center md:justify-between">
          <p>© {year} TradeCatch. {t("rightsReserved")}</p>
          <p className="max-w-2xl">{t("disclaimer")}</p>
        </Container>
      </div>
    </footer>
  );
}
