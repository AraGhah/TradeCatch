"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  CalendarDays,
  CreditCard,
  Gift,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Phone,
  Settings,
  Shield,
  UserRound,
  ClipboardList,
} from "lucide-react";
import { NotificationBell } from "@/components/app/NotificationBell";
import { SessionKeeper } from "@/components/app/SessionKeeper";
import { LogoMark } from "@/components/BrandLockup";
import {
  Sidebar,
  SidebarBody,
  SidebarLink,
  useSidebar,
} from "@/components/ui/sidebar";
import { planNameOrNull } from "@/lib/plan-names";
import { useSingleFlight } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
import { BusyLabel } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import type { ComponentProps } from "react";

/**
 * The Account Center menu, in the order owners use it. Appointments belong to
 * Professional, so Essential accounts never see that entry. Everything else
 * (receptionist rules, alerts, text follow-ups, the website service) is reached
 * from Business settings so the menu stays short.
 */
const NAV_ITEMS = [
  { href: "/app", key: "overview", icon: LayoutDashboard },
  { href: "/app/calls", key: "callActivity", icon: Phone },
  { href: "/app/leads", key: "customerRequests", icon: ClipboardList },
  {
    href: "/app/bookings",
    key: "appointments",
    icon: CalendarDays,
    professionalOnly: true,
  },
  { href: "/app/conversations", key: "smsActivity", icon: MessageSquare },
  { href: "/app/settings", key: "businessSettings", icon: Settings },
  { href: "/billing", key: "billing", icon: CreditCard },
  { href: "/app/referrals", key: "referrals", icon: Gift },
  { href: "/app/settings/account", key: "accountSettings", icon: UserRound },
  { href: "/app/support", key: "support", icon: HelpCircle },
] as const;

const ALL_HREFS: string[] = NAV_ITEMS.map((item) => item.href);

const ICON_CLASS = "h-5 w-5 shrink-0 text-heading";
const ICON_STROKE = 1.75;

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

function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "TC";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function BrandHeader({ href = "/app" as const }: { href?: "/app" }) {
  const { open, animate } = useSidebar();
  return (
    <Link
      href={href}
      className="relative z-20 flex items-center gap-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2"
      aria-label="TradeCatch"
    >
      <LogoMark className="h-8 w-8 rounded-[9px]" />
      <motion.span
        transition={{ duration: 0 }}
        animate={{
          display: animate ? (open ? "inline-block" : "none") : "inline-block",
          opacity: animate ? (open ? 1 : 0) : 1,
        }}
        className="font-cabinet text-[17px] font-extrabold tracking-[-0.03em] text-heading whitespace-pre"
      >
        TradeCatch
      </motion.span>
    </Link>
  );
}

function AccountFooter({
  userName,
  orgName,
  planName,
  isDemo,
  demoBadge,
  onLogout,
  logoutPending,
  logoutLabel,
  loggingOutLabel,
}: {
  userName: string;
  orgName: string;
  planName: string | null;
  isDemo: boolean;
  demoBadge: string;
  onLogout: () => void;
  logoutPending: boolean;
  logoutLabel: string;
  loggingOutLabel: string;
}) {
  const { open, animate } = useSidebar();
  const initials = userInitials(userName);

  return (
    <div className="flex flex-col gap-3 border-t border-[rgb(var(--ink-rgb)/0.08)] pt-4">
      <div className="flex items-center gap-2 px-2 py-1">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-[11px] font-semibold tracking-wide text-white"
          aria-hidden
        >
          {initials}
        </span>
        <motion.div
          transition={{ duration: 0 }}
          animate={{
            display: animate ? (open ? "block" : "none") : "block",
            opacity: animate ? (open ? 1 : 0) : 1,
          }}
          className="min-w-0"
        >
          <p className="truncate text-sm font-medium text-heading">
            {userName}
          </p>
          <p className="truncate text-xs text-muted">
            {planName ? `${orgName} · ${planName}` : orgName}
            {isDemo ? ` · ${demoBadge}` : null}
          </p>
        </motion.div>
      </div>
      <button
        type="button"
        disabled={logoutPending}
        aria-busy={logoutPending || undefined}
        aria-label={logoutLabel}
        title={!open && animate ? logoutLabel : undefined}
        onClick={onLogout}
        className={cn(
          "group/sidebar flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-muted",
          "hover:bg-[rgb(var(--ink-rgb)/0.05)] hover:text-heading",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        <LogOut className={ICON_CLASS} strokeWidth={ICON_STROKE} aria-hidden />
        <motion.span
          transition={{ duration: 0 }}
          animate={{
            display: animate
              ? open
                ? "inline-block"
                : "none"
              : "inline-block",
            opacity: animate ? (open ? 1 : 0) : 1,
          }}
          className="whitespace-pre"
        >
          <BusyLabel pending={logoutPending} busyLabel={loggingOutLabel}>
            {logoutLabel}
          </BusyLabel>
        </motion.span>
      </button>
    </div>
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
  const planName = planNameOrNull(plan);
  const [open, setOpen] = useState(false);

  // Close the mobile drawer after the route changes.
  const [menuPath, setMenuPath] = useState(pathname);
  if (pathname !== menuPath) {
    setMenuPath(pathname);
    setOpen(false);
  }

  const logoutFlight = useSingleFlight();
  async function logoutHandler() {
    try {
      await timedFetch("/api/auth/logout", { method: "POST" });
    } catch {
      return;
    }
    window.location.href = locale === "fr" ? "/fr/connexion" : "/login";
  }

  const visibleItems = NAV_ITEMS.filter(
    (item) => !("professionalOnly" in item) || appointmentsEnabled,
  );

  return (
    <div className="flex min-h-screen w-full flex-1 flex-col bg-paper font-cabinet md:flex-row">
      <Sidebar open={open} setOpen={setOpen}>
        <SidebarBody
          className="justify-between gap-8"
          openMenuLabel={t("nav.menu")}
          closeMenuLabel={t("nav.closeMenu")}
          mobileLeading={
            <div className="flex min-w-0 items-center gap-2">
              <LogoMark className="h-8 w-8 rounded-[9px]" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-heading">
                  TradeCatch
                </p>
                <p className="truncate text-xs text-muted">{orgName}</p>
              </div>
            </div>
          }
          mobileTrailing={<NotificationBell organizationId={organizationId} />}
        >
          <div className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
            <div className="hidden md:block">
              <BrandHeader />
            </div>
            <div className="mt-2 md:hidden">
              <BrandHeader />
            </div>
            <nav aria-label="TradeCatch" className="mt-8 flex flex-col gap-1">
              {isPlatformAdmin ? (
                <SidebarLink
                  link={{
                    label: t("nav.admin"),
                    href: "/admin",
                    icon: (
                      <Shield
                        className={ICON_CLASS}
                        strokeWidth={ICON_STROKE}
                        aria-hidden
                      />
                    ),
                  }}
                  active={pathname.startsWith("/admin")}
                />
              ) : null}
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const active = itemIsActive(pathname, item.href);
                return (
                  <SidebarLink
                    key={item.href}
                    link={{
                      label: t(`nav.${item.key}`),
                      href: item.href as ComponentProps<typeof Link>["href"],
                      icon: (
                        <Icon
                          className={ICON_CLASS}
                          strokeWidth={ICON_STROKE}
                          aria-hidden
                        />
                      ),
                    }}
                    active={active}
                  />
                );
              })}
            </nav>
          </div>
          <AccountFooter
            userName={userName}
            orgName={orgName}
            planName={planName}
            isDemo={isDemo}
            demoBadge={t("demoAccountBadge")}
            onLogout={() => void logoutFlight.run(logoutHandler)}
            logoutPending={logoutFlight.pending}
            logoutLabel={t("nav.logout")}
            loggingOutLabel={t("nav.loggingOut")}
          />
        </SidebarBody>
      </Sidebar>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-0 hidden justify-end px-6 pt-6 md:flex md:px-8">
          <NotificationBell organizationId={organizationId} />
        </div>
        <div className="min-w-0 flex-1 px-4 py-4 md:px-8 md:py-6">
          <SessionKeeper accessExpiresAt={accessExpiresAt} locale={locale} />
          {children}
        </div>
      </div>
    </div>
  );
}
