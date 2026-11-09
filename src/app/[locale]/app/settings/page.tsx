import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PLAN_DISPLAY_NAMES, orgHasFeature } from "@/product/saas/entitlements";
import { requireTenantContext } from "@/product/saas/tenant";
import { ApiKeyCreateButton } from "@/components/app/ApiKeyCreateButton";
import { BusinessFeaturesForm } from "@/components/app/BusinessFeaturesForm";
import { SettingsIntegrationsForm } from "@/components/app/SettingsIntegrationsForm";
import { getGrowthStore } from "@/product/growth";
import { GmailSettings } from "@/components/app/GmailSettings";
import { asNotice } from "@/product/gmail/http";
import {
  gmailConfigured,
  gmailPushConfigured,
  gmailWatchActive,
  readGmailEnv,
} from "@/product/gmail/oauth";
import { getGmailStore } from "@/product/gmail/runtime";

type HubHref =
  | "/app/receptionist"
  | "/app/calls/settings"
  | "/app/settings/notifications"
  | "/app/automations"
  | "/app/settings/calendar"
  | "/app/settings/sms-receptionist"
  | "/app/website-services"
  | "/app/settings/security"
  | "/app/receptionist/privacy"
  | "/app/test-center"
  | "/app/onboarding"
  | "/app/help";

export default async function AppSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ gmail?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("app.settings");

  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  const { organization } = auth.ctx;
  const settings = await getGrowthStore().getOrgSettings(organization.id);
  const appointments = orgHasFeature(organization.plan, "APPOINTMENT_BOOKING");
  const gmailAccount = await getGmailStore()
    .getAccount(organization.id, auth.ctx.user.id)
    .catch(() => null);
  const gmailEnv = readGmailEnv();

  // Where each part of the business is set up. Appointments appear only on Professional.
  const hub: { href: HubHref; key: string }[] = [
    { href: "/app/receptionist", key: "receptionist" },
    { href: "/app/calls/settings", key: "phone" },
    { href: "/app/settings/notifications", key: "alerts" },
    { href: "/app/automations", key: "followUps" },
    { href: "/app/settings/sms-receptionist", key: "contacts" },
    ...(appointments
      ? [{ href: "/app/settings/calendar" as const, key: "calendar" }]
      : []),
    { href: "/app/website-services", key: "website" },
    { href: "/app/settings/security", key: "security" },
    { href: "/app/receptionist/privacy", key: "privacy" },
    { href: "/app/test-center", key: "test" },
    { href: "/app/onboarding", key: "checklist" },
    { href: "/app/help", key: "help" },
  ];

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("headline")}
        </h1>
        <p className="mt-2 max-w-2xl text-navy/70">{t("intro")}</p>
      </header>

      <GmailSettings
        configured={gmailConfigured(gmailEnv)}
        status={gmailAccount?.status || "not_connected"}
        email={gmailAccount?.email || null}
        lastError={gmailAccount?.lastError || null}
        lastSyncAt={gmailAccount?.lastSyncAt || null}
        pushConfigured={gmailPushConfigured(gmailEnv)}
        pushEnabled={gmailWatchActive(gmailAccount, gmailEnv)}
        notice={asNotice(query.gmail)}
      />

      <section className="rounded-md border border-navy/10 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
          {t("plan")}
        </h2>
        <p className="mt-2 text-lg font-semibold text-navy">
          {PLAN_DISPLAY_NAMES[organization.plan]}
        </p>
        <p className="mt-1 text-sm text-navy/70">
          {organization.name} · {auth.ctx.user.email}
        </p>
        {organization.city || organization.industry ? (
          <p className="mt-1 text-sm text-navy/70">
            {[organization.industry, organization.city].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href="/billing" className="font-semibold text-navy underline">
            {t("planBilling")}
          </Link>
          <Link
            href="/app/settings/account"
            className="font-semibold text-navy underline"
          >
            {t("planAccount")}
          </Link>
        </p>
        {!appointments ? (
          <p className="mt-3 text-sm text-navy/70">{t("planProfessionalNote")}</p>
        ) : null}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
          {t("hubTitle")}
        </h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {hub.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="block min-h-11 rounded-md border border-navy/10 bg-white px-4 py-3 hover:bg-navy/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2"
              >
                <span className="block text-sm font-semibold text-navy">
                  {t(`hub.${item.key}.title`)}
                </span>
                <span className="mt-1 block text-sm text-navy/70">
                  {t(`hub.${item.key}.body`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-md border border-navy/10 bg-white px-5 py-4">
        <BusinessFeaturesForm
          organizationId={organization.id}
          initial={organization.features}
          canEdit={
            auth.ctx.membership.role === "owner" ||
            auth.ctx.membership.role === "admin" ||
            auth.ctx.isPlatformAdmin
          }
        />
      </section>

      <section className="rounded-md border border-navy/10 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
          {t("integrations")}
        </h2>
        <p className="mt-2 text-sm text-navy/70">{t("integrationsIntro")}</p>
        <SettingsIntegrationsForm
          initialNotifyEmail={settings.notifyEmail}
          initialGoogleReviewUrl={settings.googleReviewUrl}
          initialCrmWebhookUrl={settings.crmWebhookUrl}
          reviewRequestsEnabled={orgHasFeature(
            organization.plan,
            "REVIEW_AUTOMATION",
          )}
          crmEnabled={orgHasFeature(organization.plan, "CRM_INTEGRATION_LIMITED")}
        />
      </section>

      {orgHasFeature(organization.plan, "WEBSITE_LEAD_CAPTURE") ? (
        <details className="rounded-md border border-navy/10 bg-white px-5 py-4">
          <summary className="cursor-pointer text-sm font-semibold text-navy">
            {t("apiKeyTitle")}
          </summary>
          <p className="mt-2 text-sm text-navy/70">{t("apiKeyIntro")}</p>
          <ApiKeyCreateButton />
        </details>
      ) : null}
    </div>
  );
}
