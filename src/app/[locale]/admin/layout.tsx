import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { isPlatformAdminUser } from "@/product/saas/platform-admin";
import { requireTenantContext } from "@/product/saas/tenant";
import { Link } from "@/i18n/navigation";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const auth = await requireTenantContext();
  if (!auth.ok) {
    redirect(locale === "fr" ? "/fr/connexion" : "/login");
  }
  if (!isPlatformAdminUser(auth.ctx.user)) {
    redirect(locale === "fr" ? "/fr/app" : "/app");
  }

  return (
    <div className="min-h-[70vh] border-b border-navy/10 bg-[var(--color-surface,#f7f5f1)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-navy/70">
            TradeCatch Admin
          </p>
          <nav className="flex flex-wrap gap-2 text-sm">
            <Link
              href="/admin"
              className="rounded-md px-3 py-2 text-navy hover:bg-navy/5"
            >
              Businesses
            </Link>
            <Link
              href="/admin/monitoring"
              className="rounded-md px-3 py-2 text-navy hover:bg-navy/5"
            >
              System monitoring
            </Link>
            <Link
              href="/admin/qa"
              className="rounded-md px-3 py-2 text-navy hover:bg-navy/5"
            >
              Test Center
            </Link>
            <Link
              href="/app"
              className="rounded-md px-3 py-2 text-navy/70 hover:bg-navy/5"
            >
              Contractor app
            </Link>
          </nav>
        </div>
        {children}
      </div>
    </div>
  );
}
