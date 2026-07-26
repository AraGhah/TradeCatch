import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Container } from "@/components/Container";
import { ManageCookiesButton } from "@/components/ManageCookiesButton";
import { BrandLockup } from "@/components/BrandLockup";

export function Footer() {
  const t = useTranslations("footer");
  const nav = useTranslations("nav");
  const site = useTranslations("site");
  const legal = useTranslations("legal");
  const year = new Date().getFullYear();
  const phoneDisplay = site("phone").replace(/-/g, "·");

  const linkClass =
    "text-left text-[14.5px] text-[rgba(255,255,255,0.75)] transition-colors duration-150 hover:text-white";

  return (
    <footer className="border-t border-white/[0.08] bg-navy text-[rgba(255,255,255,0.62)]">
      <Container
        className="pt-[clamp(52px,6vw,80px)] pb-10"
      >
        {/*
          4-track mental model: brand spans 2, Company + Legal take 1 each.
          auto-fit collapses cleanly; brand keeps min-width so it doesn't
          squeeze beside the link columns on mid widths.
        */}
        <div
          className="grid items-start"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "clamp(28px, 4vw, 48px)",
          }}
        >
          <div
            className="min-w-0"
            style={{ gridColumn: "span 2", minWidth: "min(100%, 260px)" }}
          >
            <BrandLockup inverted />
            <p className="mt-5 max-w-[32em] text-[15.5px] leading-[1.65] text-[rgba(255,255,255,0.7)]">
              {t("description")}
            </p>
            <p className="mt-5 font-mono text-[12px] tracking-[0.05em] text-[rgba(255,255,255,0.64)]">
              {site("serviceArea")}
            </p>
            <p className="mt-3 flex flex-wrap items-center gap-x-[14px] gap-y-2 text-[14px]">
              <a
                href={`tel:${site("phoneHref")}`}
                className="text-[rgba(255,255,255,0.8)] transition-colors hover:text-orange"
              >
                {phoneDisplay}
              </a>
              <span aria-hidden className="text-[rgba(255,255,255,0.25)]">
                ·
              </span>
              <a
                href={`mailto:${site("email")}`}
                className="text-[rgba(255,255,255,0.8)] transition-colors hover:text-orange"
              >
                {site("email")}
              </a>
            </p>
          </div>

          <div className="min-w-0">
            <p className="m-0 font-mono text-[10.5px] font-medium tracking-[0.14em] text-[rgba(255,255,255,0.64)] uppercase">
              {t("company")}
            </p>
            <ul className="mt-[18px] flex list-none flex-col items-start gap-[11px] p-0">
              <li>
                <Link href="/services" className={linkClass}>
                  {nav("services")}
                </Link>
              </li>
              <li>
                <Link href="/how-it-works" className={linkClass}>
                  {nav("howItWorks")}
                </Link>
              </li>
              <li>
                <Link href="/industries" className={linkClass}>
                  {nav("industries")}
                </Link>
              </li>
              <li>
                <Link href="/pricing" className={linkClass}>
                  {nav("pricing")}
                </Link>
              </li>
              <li>
                <Link href="/about" className={linkClass}>
                  {nav("about")}
                </Link>
              </li>
              <li>
                <Link href="/faq" className={linkClass}>
                  {nav("faq")}
                </Link>
              </li>
            </ul>
          </div>

          <div className="min-w-0">
            <p className="m-0 font-mono text-[10.5px] font-medium tracking-[0.14em] text-[rgba(255,255,255,0.64)] uppercase">
              {t("legal")}
            </p>
            <ul className="mt-[18px] flex list-none flex-col items-start gap-[11px] p-0">
              <li>
                <Link href="/privacy-policy" className={linkClass}>
                  {t("legalLinks.privacy")}
                </Link>
              </li>
              <li>
                <Link href="/terms-of-service" className={linkClass}>
                  {t("legalLinks.terms")}
                </Link>
              </li>
              <li>
                <Link href="/cookie-policy" className={linkClass}>
                  {t("legalLinks.cookies")}
                </Link>
              </li>
              <li>
                <Link href="/acceptable-use-policy" className={linkClass}>
                  {t("legalLinks.acceptableUse")}
                </Link>
              </li>
              <li>
                <Link href="/accessibility-statement" className={linkClass}>
                  {t("legalLinks.accessibility")}
                </Link>
              </li>
              <li>
                <ManageCookiesButton
                  label={t("manageCookies")}
                  className={linkClass}
                />
              </li>
            </ul>
          </div>
        </div>
      </Container>

      <div className="border-t border-white/[0.08]">
        <Container className="flex flex-wrap items-center justify-between gap-4 py-6">
          <p className="m-0 font-mono text-[11.5px] text-[rgba(255,255,255,0.62)]">
            © {year} TradeCatch. {t("rightsReserved")}
          </p>
          <p className="m-0 max-w-[60em] text-[12.5px] leading-[1.6] text-[rgba(255,255,255,0.62)]">
            {t("disclaimer")}
          </p>
        </Container>
      </div>
    </footer>
  );
}
