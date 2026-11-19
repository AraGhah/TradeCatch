"use client";

import { useId, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

const GROUPS = [
  {
    items: [
      { href: "/admin", key: "navOverview" },
      { href: "/admin/businesses", key: "navBusinesses" },
      { href: "/admin/subscriptions", key: "navSubscriptions" },
      { href: "/admin/payments", key: "navPayments" },
      { href: "/admin/website-requests", key: "navWebsiteRequests" },
      { href: "/admin/system-health", key: "navHealth" },
      { href: "/admin/audit-logs", key: "navAuditLogs" },
    ],
  },
  {
    items: [
      { href: "/admin/sales", key: "navSales" },
      { href: "/admin/installations", key: "navInstallations" },
      { href: "/admin/referrals", key: "navReferrals" },
      { href: "/admin/analytics", key: "navAnalytics" },
    ],
  },
  {
    items: [
      { href: "/admin/monitoring/receptionist", key: "navReceptionist" },
      { href: "/admin/monitoring", key: "navReliability" },
      { href: "/admin/monitoring/jobs", key: "navJobs" },
      { href: "/admin/monitoring/costs", key: "navCosts" },
    ],
  },
  {
    items: [
      { href: "/admin/support", key: "navSupport" },
      { href: "/admin/account-recovery", key: "navAccountRecovery" },
      { href: "/admin/qa", key: "navQa" },
      { href: "/admin/launch", key: "navLaunch" },
      { href: "/admin/pilots", key: "navPilots" },
      { href: "/app", key: "navApp" },
    ],
  },
] as const;

const ITEMS = GROUPS.flatMap((group) =>
  group.items.map((item) => ({ href: item.href as string, key: item.key })),
);
const ALL = ITEMS.map((item) => item.href);

function active(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  const matches = pathname === href || pathname.startsWith(`${href}/`);
  if (!matches) return false;
  return !ALL.some(
    (other) =>
      other !== href &&
      other.length > href.length &&
      (pathname === other || pathname.startsWith(`${other}/`)),
  );
}

export function AdminNav() {
  const t = useTranslations("admin.platform");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const currentKey = ITEMS.find((item) => active(pathname, item.href))?.key;

  return (
    <nav aria-label="TradeCatch Admin" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-navy/70">
          TradeCatch Admin
        </p>
        {/* Below md the menu folds away so the page content is not pushed down the screen. */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-navy/25 bg-white px-3 py-2 text-sm font-semibold text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 md:hidden"
        >
          <span>{currentKey ? t(currentKey) : t("navMenu")}</span>
          <span aria-hidden="true">{open ? "▴" : "▾"}</span>
          <span className="sr-only">{t("navMenu")}</span>
        </button>
      </div>
      <div id={listId} className={`${open ? "flex" : "hidden"} flex-col gap-4 md:flex`}>
        {GROUPS.map((group) => (
          <ul key={group.items[0].href} className="flex flex-col">
            {group.items.map((item) => {
              const on = active(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={on ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`block rounded-md px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 md:py-1.5 ${
                      on ? "bg-navy text-white" : "text-navy hover:bg-navy/5"
                    }`}
                  >
                    {t(item.key)}
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}
      </div>
    </nav>
  );
}
