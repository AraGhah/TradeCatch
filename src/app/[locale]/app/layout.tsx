import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import {
  requireBillingContext,
  requireTenantContext,
} from "@/product/saas/tenant";
import { AppShell } from "@/components/app/AppShell";
import { FullMessagesProvider } from "@/components/FullMessagesProvider";
import { orgHasFeature } from "@/product/saas/entitlements";
import { BusinessAnalyticsFlag } from "@/components/app/BusinessAnalyticsFlag";
import { loadPrivacySettings } from "@/product/privacy/runtime";

export default async function AppLayout({
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
    if (auth.status === 403) {
      const billing = await requireBillingContext();
      if (billing.ok && billing.ctx.organization.status !== "active") {
        redirect(locale === "fr" ? "/fr/facturation" : "/billing");
      }
    }
    redirect(locale === "fr" ? "/fr/connexion" : "/login");
  }

  // The business's analytics choice; unreadable counts as off.
  const analyticsAllowed = await loadPrivacySettings(auth.ctx.organization.id)
    .then((settings) => settings.analyticsEnabled)
    .catch(() => false);

  return (
    <FullMessagesProvider>
      <BusinessAnalyticsFlag allowed={analyticsAllowed} />
      <AppShell
        orgName={auth.ctx.organization.name}
        plan={auth.ctx.organization.plan}
        userName={auth.ctx.user.name}
        locale={locale === "fr" ? "fr" : "en"}
        accountType={auth.ctx.organization.accountType}
        isPlatformAdmin={auth.ctx.isPlatformAdminIdentity}
        organizationId={auth.ctx.organization.id}
        accessExpiresAt={auth.ctx.accessExpiresAt}
        appointmentsEnabled={orgHasFeature(
          auth.ctx.organization.plan,
          "APPOINTMENT_BOOKING",
        )}
      >
        {children}
      </AppShell>
    </FullMessagesProvider>
  );
}
