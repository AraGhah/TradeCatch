"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { GmailSyncBadge } from "@/components/app/GmailSyncBadge";
import { NotificationBell } from "@/components/app/NotificationBell";

const GROUPS = [
  {
    label: "groupHome",
    items: [{ href: "/app", key: "dashboard" }],
  },
  {
    label: "groupCustomers",
    items: [
      { href: "/app/leads", key: "customers" },
      { href: "/app/mail", key: "gmail" },
      { href: "/app/pipeline", key: "pipeline" },
    ],
  },
  {
    label: "groupReceptionist",
    items: [
      { href: "/app/receptionist", key: "receptionistConfig" },
      { href: "/app/receptionist/voice", key: "receptionistVoice" },
      { href: "/app/calls", key: "callHistory" },
      { href: "/app/test-center", key: "testReceptionist" },
    ],
  },
  {
    label: "groupAppointments",
    items: [
      { href: "/app/bookings", key: "calendar" },
      { href: "/app/bookings/availability", key: "availability" },
    ],
  },
  {
    label: "groupAutomations",
    items: [
      { href: "/app/automations/missed-call", key: "missedCall" },
      { href: "/app/automations/quotes", key: "quoteFollowUps" },
      { href: "/app/automations", key: "reminders" },
    ],
  },
  {
    label: "groupInsights",
    items: [
      { href: "/app/analytics", key: "analytics" },
      { href: "/app/notifications", key: "notifications" },
    ],
  },
  {
    label: "groupAccount",
    items: [
      { href: "/app/settings/account", key: "account" },
      { href: "/app/settings", key: "settings" },
      { href: "/app/website-services", key: "websiteServices" },
      { href: "/app/referrals", key: "referrals" },
      { href: "/app/onboarding", key: "onboarding" },
      { href: "/app/help", key: "help" },
      { href: "/app/support", key: "support" },
    ],
  },
] as const;

const ALL_HREFS = GROUPS.flatMap((group) => group.items.map((item) => item.href));

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
  gmailEnabled = false,
}: {
  children: React.ReactNode;
  orgName: string;
  plan: string;
  userName: string;
  locale: "en" | "fr";
  accountType?: string;
  isPlatformAdmin?: boolean;
  organizationId: string;
  /** False when Google credentials are not configured: the Gmail entry would lead nowhere. */
  gmailEnabled?: boolean;
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
    <div className="min-h-[70vh] border-b border-[rgb(var(--ink-rgb)/0.1)] bg-paper">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 md:grid-cols-[16rem_minmax(0,1fr)] md:px-6 md:py-10">
        <aside className="flex flex-col gap-6 md:sticky md:top-6 md:self-start">
          <div>
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
              {userName} ·{" "}
              {plan === "receptionist"
                ? t("plan.receptionist")
                : plan === "growth"
                  ? t("plan.growth")
                  : t("plan.starter")}
            </p>
          </div>
          <button
            type="button"
            className={`w-fit rounded-md border border-[rgb(var(--ink-rgb)/0.15)] px-3 py-1.5 text-sm font-semibold text-heading md:hidden ${FOCUS_RING}`}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            {navOpen ? t("nav.closeMenu") : t("nav.menu")}
          </button>
          <div className={navOpen ? "flex flex-col gap-6" : "hidden md:flex md:flex-col md:gap-6"}>
          <nav aria-label="TradeCatch" className="flex flex-col gap-5">
            {isPlatformAdmin ? (
              <Link
                href="/admin"
                className={`w-fit rounded-md px-2 py-1 text-sm text-muted hover:bg-[rgb(var(--ink-rgb)/0.05)] ${FOCUS_RING}`}
              >
                {t("nav.admin")}
              </Link>
            ) : null}
            {GROUPS.map((group) => (
              <div key={group.label}>
                <p className="px-2 font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                  {t(`nav.${group.label}`)}
                </p>
                <ul className="mt-1 flex flex-col">
                  {group.items
                    .filter((item) => item.key !== "gmail" || gmailEnabled)
                    .map((item) => {
                    const active = itemIsActive(pathname, item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={`block rounded-md px-2 py-1.5 text-sm ${FOCUS_RING} ${
                            active
                              ? "bg-navy text-white"
                              : "text-heading hover:bg-[rgb(var(--ink-rgb)/0.05)]"
                          }`}
                        >
                          {t(`nav.${item.key}`)}
                          {item.key === "gmail" ? <GmailSyncBadge /> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
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
          <div className="mb-6 flex justify-end">
            <NotificationBell organizationId={organizationId} />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
