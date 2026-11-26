import { ArrowLeft, Lock, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { BrandLockup } from "@/components/BrandLockup";
import { TradeCatchProductPreview } from "@/components/ui/tradecatch-product-preview";
import { Link } from "@/i18n/navigation";
import { PUBLIC_CONTACT_EMAIL } from "@/lib/contact";
import { cn } from "@/lib/cn";

const FOCUS =
  "rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange";
const LANGUAGES = [
  { code: "fr", name: "Français" },
  { code: "en", name: "English" },
] as const;

/**
 * The account centre around the sign-in form: a single card on a phone, and
 * from `lg` the card beside the product preview. Layout only. Signing in lives
 * in the form passed as `children` (LoginForm), which talks to the real auth
 * routes; the server decides where a signed-in person goes. There is no sign-up
 * here, and no business picker: sign-in opens the account's business.
 */
export function TradeCatchSignIn({
  locale,
  query,
  showScheduling = false,
  children,
}: {
  locale: "en" | "fr";
  /** Kept when switching language, so a return address or notice is not lost. */
  query: Record<string, string>;
  showScheduling?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("login");

  return (
    <div className="min-h-svh bg-paper text-heading lg:grid lg:grid-cols-2">
      <div className="flex min-h-svh min-w-0 flex-col px-5 py-4 sm:px-10 lg:px-12">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Link href="/" className={cn("inline-flex min-h-11 items-center", FOCUS)}>
            <BrandLockup />
          </Link>
          <nav
            aria-label={t("languageLabel")}
            className="inline-flex rounded-[var(--radius-md)] border border-[rgb(var(--ink-rgb)/0.12)] bg-surface p-0.5"
          >
            {LANGUAGES.map(({ code, name }) => (
              <Link
                key={code}
                href={{ pathname: "/login", query }}
                locale={code}
                // Nothing to gain: one of the two is the page already open.
                prefetch={false}
                lang={code}
                hrefLang={code}
                aria-current={locale === code ? "true" : undefined}
                // The name starts with the visible "FR" / "EN" (label in name).
                aria-label={`${code.toUpperCase()}, ${name}`}
                className={cn(
                  "inline-flex min-h-9 min-w-10 items-center justify-center rounded-[var(--radius-sm)] text-[13px] font-bold",
                  locale === code
                    ? "bg-navy text-white"
                    : "text-muted hover:text-heading",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-orange",
                )}
              >
                {code.toUpperCase()}
              </Link>
            ))}
          </nav>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center py-6">
          <div className="w-full max-w-[420px]">
            <Link
              href="/"
              className={cn(
                "mb-3 inline-flex min-h-8 items-center gap-1.5 text-[14px] font-medium text-secondary hover:text-heading",
                FOCUS,
              )}
            >
              <ArrowLeft aria-hidden className="h-4 w-4" />
              {t("backHome")}
            </Link>

            <div className="rounded-[var(--radius-xl)] border border-[rgb(var(--ink-rgb)/0.13)] bg-surface p-5 shadow-card sm:p-8">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-navy bg-navy text-white"
                >
                  <Lock className="h-[18px] w-[18px]" strokeWidth={1.9} />
                </span>
                <p className="m-0 text-[14px] font-bold text-ember-text">
                  {t("eyebrow")}
                </p>
              </div>
              <h1 className="mt-4 mb-0 font-heading text-[clamp(26px,3vw,32px)] font-extrabold tracking-[-0.035em] text-heading">
                {t("headline")}
              </h1>
              <p className="mt-2 mb-6 text-[15.5px] leading-[1.5] text-secondary">
                {t("intro")}
              </p>

              {children}

              <p className="m-0 mt-5 flex items-center justify-center gap-2 border-t border-[rgb(var(--ink-rgb)/0.1)] pt-4 text-[13px] text-muted">
                <ShieldCheck aria-hidden className="h-4 w-4 text-signal-text" />
                {t("secure")}
              </p>
            </div>

            <p className="mt-4 mb-0 text-center text-[13.5px] leading-[1.55] text-muted">
              {t("accountsNote")}
            </p>
            <p className="mt-2 mb-0 text-center text-[13.5px] text-muted">
              {t("help")}{" "}
              <a
                href={`mailto:${PUBLIC_CONTACT_EMAIL}`}
                className={cn("font-semibold text-heading underline underline-offset-2", FOCUS)}
              >
                {t("contact")}
              </a>
            </p>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
          <span>© {new Date().getFullYear()} TradeCatch</span>
          <Link href="/privacy-policy" className={cn("inline-flex min-h-6 items-center hover:underline", FOCUS)}>
            {t("privacy")}
          </Link>
          <Link href="/terms-of-service" className={cn("inline-flex min-h-6 items-center hover:underline", FOCUS)}>
            {t("terms")}
          </Link>
        </footer>
      </div>

      <aside className="hidden min-w-0 items-center justify-center border-l border-[rgb(var(--ink-rgb)/0.1)] bg-surface p-8 lg:flex xl:p-12">
        {/* Stays in view if the form column grows taller than the window. */}
        <div className="sticky top-6 w-full max-w-[540px]">
          <TradeCatchProductPreview showCaption showScheduling={showScheduling} />
        </div>
      </aside>
    </div>
  );
}
