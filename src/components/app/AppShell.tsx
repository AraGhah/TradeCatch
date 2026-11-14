"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { NotificationBell } from "@/components/app/NotificationBell";
import { SessionKeeper } from "@/components/app/SessionKeeper";

/** The plan names an owner can see. Plans sold before launch keep their own label. */
const KNOWN_PLANS = ["essential", "professional", "starter", "growth", "receptionist"];
function planLabelKey(plan: string): string {
  return KNOWN_PLANS.includes(plan) ? plan : "essential";
}

/**
 * The Account Center menu, in the order owners use it. Appointments belong to
 * Professional, so Essential accounts never see that entry. Everything else
 * (receptionist rules, alerts, text follow-ups, the website service) is reached
 * from Business settings so the menu stays short.
 */
const NAV_ITEMS = [
  { href: "/app", key: "overview" },
  { href: "/app/calls", key: "callActivity" },
  { href: "/app/leads", key: "customerRequests" },
  { href: "/app/bookings", key: "appointments", professionalOnly: true },
  { href: "/app/conversations", key: "smsActivity" },
  { href: "/app/settings", key: "businessSettings" },
  { href: "/billing", key: "billing" },
  { href: "/app/referrals", key: "referrals" },
  { href: "/app/settings/account", key: "accountSettings" },
  { href: "/app/support", key: "support" },
] as const;

const ALL_HREFS: string[] = NAV_ITEMS.map((item) => item.href);

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2";

function itemIsActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  const matches = pathname === href || pathname.startsWith(`${href}/`);
  if (!matches) return false;
  return !ALL_HREFS.some(
    (other) =>
      other !== href &&
      other.length > href.length &&
      (pathname === other || pathname.startsWith(`${other}/`)),
  );
}

export function AppShell({
  children,
  orgName,
  plan,
  userName,
  locale,
  accountType,
  isPlatformAdmin,
  organizationId,
  appointmentsEnabled = false,
  accessExpiresAt,
}: {
  children: React.ReactNode;
  orgName: string;
  plan: string;
  userName: string;
  locale: "en" | "fr";
  accountType?: string;
  isPlatformAdmin?: boolean;
  organizationId: string;
  /** True on Professional: the plan that includes appointments and the calendar. */
  appointmentsEnabled?: boolean;
  /** Unix seconds when the access token expires; the keeper renews it before then. */
  accessExpiresAt?: number;
}) {
  const t = useTranslations("app");
  const pathname = usePathname();
  const isDemo = accountType === "demo";
  const [navOpen, setNavOpen] = useState(false);
  // Close the mobile menu after navigating. Adjusted during render rather than in an effect.
  const [menuPath, setMenuPath] = useState(pathname);
  if (pathname !== menuPath) {
    setMenuPath(pathname);
    setNavOpen(false);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = locale === "fr" ? "/fr/connexion" : "/login";
  }

  return (
    <div className="min-h-[70vh] border-b border-[rgb(var(--ink-rgb)/0.1)] bg-paper [&_input[type=checkbox]]:h-[1.125rem] [&_input[type=checkbox]]:w-[1.125rem] [&_input[type=checkbox]]:shrink-0 [&_input[type=radio]]:h-[1.125rem] [&_input[type=radio]]:w-[1.125rem] [&_input[type=radio]]:shrink-0">
      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 md:grid-cols-[16rem_minmax(0,1fr)] md:gap-8 md:px-6 md:py-10">
        <aside className="flex flex-col gap-3 md:sticky md:top-6 md:gap-6 md:self-start">
          {/* On a phone the business name and the menu button share one row,
              so the page itself starts near the top of the screen. */}
          <div className="flex items-start justify-between gap-3 md:block">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              TradeCatch
              {isDemo ? (
                <span className="ml-2 font-mono text-[10px] tracking-[0.1em] text-ember-text">
                  {t("demoAccountBadge")}
                </span>
              ) : null}
            </p>
            <p className="mt-1 text-lg font-semibold text-heading">{orgName}</p>
            <p className="text-sm text-muted">
              {userName} · {t(`plan.${planLabelKey(plan)}`)}
            </p>
          </div>
          <button
            type="button"
            className={`min-h-11 w-fit shrink-0 rounded-md border border-[rgb(var(--ink-rgb)/0.15)] px-4 py-2.5 text-sm font-semibold text-heading md:hidden ${FOCUS_RING}`}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            {navOpen ? t("nav.closeMenu") : t("nav.menu")}
          </button>
          </div>
          <div
            className={
              navOpen
                ? "flex flex-col gap-5 rounded-[14px] border border-[rgb(var(--ink-rgb)/0.1)] bg-surface p-3 md:border-0 md:bg-transparent md:p-0"
                : "hidden md:flex md:flex-col md:gap-6"
            }
          >
          <nav aria-label="TradeCatch" className="flex flex-col gap-4 md:gap-5">
            {isPlatformAdmin ? (
              <Link
                href="/admin"
                className={`w-fit rounded-md px-3 py-2.5 text-sm text-muted hover:bg-[rgb(var(--ink-rgb)/0.05)] ${FOCUS_RING}`}
              >
                {t("nav.admin")}
              </Link>
            ) : null}
            <ul className="flex flex-col">
              {NAV_ITEMS.filter(
                (item) => !("professionalOnly" in item) || appointmentsEnabled,
              ).map((item) => {
                const active = itemIsActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`block min-h-11 rounded-md px-3 py-2.5 text-sm ${FOCUS_RING} ${
                        active
                          ? "bg-navy text-white"
                          : "text-heading hover:bg-[rgb(var(--ink-rgb)/0.05)]"
                      }`}
                    >
                      {t(`nav.${item.key}`)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <button
            type="button"
            onClick={() => void logout()}
            className={`w-fit rounded-md px-2 py-1.5 text-sm text-muted hover:bg-[rgb(var(--ink-rgb)/0.05)] ${FOCUS_RING}`}
          >
            {t("nav.logout")}
          </button>
          </div>
        </aside>
        <div className="min-w-0">
          <div className="mb-3 flex justify-end md:mb-6">
            <NotificationBell organizationId={organizationId} />
          </div>
          <SessionKeeper accessExpiresAt={accessExpiresAt} locale={locale} />
          {children}
        </div>
      </div>
    </div>
  );
}
