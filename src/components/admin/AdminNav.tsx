"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

const GROUPS = [
  {
    items: [
      { href: "/admin", key: "navOverview" },
      { href: "/admin/sales", key: "navSales" },
      { href: "/admin/installations", key: "navInstallations" },
      { href: "/admin/businesses", key: "navBusinesses" },
      { href: "/admin/billing", key: "navBilling" },
      { href: "/admin/analytics", key: "navAnalytics" },
    ],
  },
  {
    items: [
      { href: "/admin/monitoring/receptionist", key: "navReceptionist" },
      { href: "/admin/monitoring", key: "navHealth" },
      { href: "/admin/monitoring/jobs", key: "navJobs" },
      { href: "/admin/monitoring/costs", key: "navCosts" },
    ],
  },
  {
    items: [
      { href: "/admin/support", key: "navSupport" },
      { href: "/admin/qa", key: "navQa" },
      { href: "/admin/launch", key: "navLaunch" },
      { href: "/admin/pilots", key: "navPilots" },
      { href: "/app", key: "navApp" },
    ],
  },
] as const;

const ALL = GROUPS.flatMap((group) => group.items.map((item) => item.href));

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
  return (
    <nav aria-label="TradeCatch Admin" className="flex flex-col gap-4">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-navy/70">
        TradeCatch Admin
      </p>
      {GROUPS.map((group) => (
        <ul key={group.items[0].href} className="flex flex-col">
          {group.items.map((item) => {
            const on = active(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  className={`block rounded-md px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 ${
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
    </nav>
  );
}
