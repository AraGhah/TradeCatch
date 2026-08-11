"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

export function AppShell({
  children,
  orgName,
  plan,
  userName,
  locale,
}: {
  children: React.ReactNode;
  orgName: string;
  plan: string;
  userName: string;
  locale: "en" | "fr";
}) {
  const t = useTranslations("app");

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = locale === "fr" ? "/fr/connexion" : "/login";
  }

  return (
    <div className="min-h-[70vh] border-b border-navy/10 bg-[var(--color-surface,#f7f5f1)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 md:px-6 md:py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-navy/50">
              TradeCatch
            </p>
            <p className="mt-1 text-lg font-semibold text-navy">{orgName}</p>
            <p className="text-sm text-navy/60">
              {userName} · {plan === "growth" ? t("plan.growth") : t("plan.starter")}
            </p>
          </div>
          <nav className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <Link
              href="/app"
              className="rounded-md px-3 py-2 text-navy hover:bg-navy/5"
            >
              {t("nav.dashboard")}
            </Link>
            <Link
              href="/app/leads"
              className="rounded-md px-3 py-2 text-navy hover:bg-navy/5"
            >
              {t("nav.leads")}
            </Link>
            <Link
              href="/app/website-leads"
              className="rounded-md px-3 py-2 text-navy hover:bg-navy/5"
            >
              {t("nav.websiteLeads")}
            </Link>
            <Link
              href="/app/quotes"
              className="rounded-md px-3 py-2 text-navy hover:bg-navy/5"
            >
              {t("nav.quotes")}
            </Link>
            <Link
              href="/app/bookings"
              className="rounded-md px-3 py-2 text-navy hover:bg-navy/5"
            >
              {t("nav.bookings")}
            </Link>
            <Link
              href="/app/pipeline"
              className="rounded-md px-3 py-2 text-navy hover:bg-navy/5"
            >
              {t("nav.pipeline")}
            </Link>
            <Link
              href="/app/reviews"
              className="rounded-md px-3 py-2 text-navy hover:bg-navy/5"
            >
              {t("nav.reviews")}
            </Link>
            <Link
              href="/app/timeline"
              className="rounded-md px-3 py-2 text-navy hover:bg-navy/5"
            >
              {t("nav.timeline")}
            </Link>
            <Link
              href="/app/inbox"
              className="rounded-md px-3 py-2 text-navy hover:bg-navy/5"
            >
              {t("nav.inbox")}
            </Link>
            <Link
              href="/app/onboarding"
              className="rounded-md px-3 py-2 text-navy hover:bg-navy/5"
            >
              {t("nav.onboarding")}
            </Link>
            <Link
              href="/app/settings"
              className="rounded-md px-3 py-2 text-navy hover:bg-navy/5"
            >
              {t("nav.settings")}
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-md px-3 py-2 text-navy/70 hover:bg-navy/5"
            >
              {t("nav.logout")}
            </button>
          </nav>
        </div>
        {children}
      </div>
    </div>
  );
}
