"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

const NAV_ITEMS = [
  { href: "/app", key: "dashboard" },
  { href: "/app/leads", key: "leads" },
  { href: "/app/website-leads", key: "websiteLeads" },
  { href: "/app/quotes", key: "quotes" },
  { href: "/app/bookings", key: "bookings" },
  { href: "/app/pipeline", key: "pipeline" },
  { href: "/app/reviews", key: "reviews" },
  { href: "/app/timeline", key: "timeline" },
  { href: "/app/inbox", key: "inbox" },
  { href: "/app/onboarding", key: "onboarding" },
  { href: "/app/settings", key: "settings" },
] as const;

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 focus-visible:ring-offset-2";

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
  const pathname = usePathname();

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
          <nav
            aria-label={t("nav.dashboard")}
            className="flex flex-wrap items-center gap-2 text-sm font-medium"
          >
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-3 py-2 ${FOCUS_RING} ${
                    active ? "bg-navy/10 text-navy" : "text-navy hover:bg-navy/5"
                  }`}
                >
                  {t(`nav.${item.key}`)}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => void logout()}
              className={`rounded-md px-3 py-2 text-navy/70 hover:bg-navy/5 ${FOCUS_RING}`}
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
