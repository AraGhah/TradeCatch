import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Container } from "@/components/Container";
import { ManageCookiesButton } from "@/components/ManageCookiesButton";
import { BrandLockup } from "@/components/BrandLockup";
import { EmailContactLink } from "@/components/EmailContactLink";

export function Footer() {
  const t = useTranslations("footer");
  const nav = useTranslations("nav");
  const site = useTranslations("site");
  const year = new Date().getFullYear();

  const linkClass =
    "block py-1.5 text-left text-[14.5px] text-[rgba(255,255,255,0.75)] transition-colors duration-150 hover:text-white";

  return (
    <footer className="border-t border-white/[0.08] bg-navy text-[rgba(255,255,255,0.62)]">
      <Container
        className="pt-[clamp(36px,4.4vw,56px)] pb-6"
      >
        {/*
          4-track mental model: brand spans 2, Company + Legal take 1 each.
          auto-fit collapses cleanly; brand keeps min-width so it doesn't
          squeeze beside the link columns on mid widths. The header already
          links Services, How it works, Industries, Pricing and Referral, so
          they are not repeated here.
        */}
        <div className="grid grid-cols-2 items-start gap-x-6 gap-y-6 min-[700px]:grid-cols-[1.3fr_1fr_1fr] min-[700px]:gap-[clamp(24px,4vw,48px)] lg:grid-cols-[2fr_1fr_1fr]">
          <div className="min-w-0 [grid-column:1/-1] min-[700px]:[grid-column:auto]">
            <BrandLockup inverted />
            <p className="mt-4 max-w-[32em] text-[15px] leading-[1.6] text-[rgba(255,255,255,0.74)]">
              {t("description")}
            </p>
            <p className="mt-3 font-mono text-[12px] tracking-[0.05em] text-[rgba(255,255,255,0.7)]">
              {site("serviceArea")}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-[14px] gap-y-2 text-[14px]">
              <EmailContactLink
                email={site("email")}
                className="text-[rgba(255,255,255,0.8)] transition-colors hover:text-orange"
              >
                {site("email")}
              </EmailContactLink>
            </div>
          </div>

          <div className="col-span-2 min-w-0 min-[700px]:col-span-1">
            <p className="m-0 font-mono text-[10.5px] font-medium tracking-[0.14em] text-[rgba(255,255,255,0.64)] uppercase">
              {t("company")}
            </p>
            <ul className="mt-2 flex list-none flex-row flex-wrap items-start gap-x-5 gap-y-0 p-0 min-[700px]:mt-3 min-[700px]:flex-col min-[700px]:gap-x-0">
              <li>
                <Link href="/receptionist" className={linkClass}>
                  {nav("aiReceptionist")}
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
              <li>
                <Link href="/help" className={linkClass}>
                  {nav("help")}
                </Link>
              </li>
            </ul>
          </div>

          <div className="col-span-2 min-w-0 min-[700px]:col-span-1">
            <p className="m-0 font-mono text-[10.5px] font-medium tracking-[0.14em] text-[rgba(255,255,255,0.64)] uppercase">
              {t("legal")}
            </p>
            <ul className="mt-2 flex list-none flex-row flex-wrap items-start gap-x-5 gap-y-0 p-0 min-[700px]:mt-3 min-[700px]:flex-col min-[700px]:gap-x-0">
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
                <Link
                  href="/emergency-service-disclaimer"
                  className={linkClass}
                >
                  {t("legalLinks.emergency")}
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
        <Container className="flex flex-wrap items-center justify-between gap-3 py-4">
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
