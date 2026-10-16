import { setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { BillingDashboard } from "@/components/app/BillingDashboard";

export default async function AppBillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);

  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  return (
    <BillingDashboard
      organizationId={auth.ctx.organization.id}
      locale={locale === "fr" ? "fr" : "en"}
      checkoutState={query.checkout ?? null}
    />
  );
}
