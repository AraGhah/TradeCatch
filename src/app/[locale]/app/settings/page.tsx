import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  FEATURE_LABELS,
  featuresForPlan,
  growthUpsellFeatures,
  orgHasFeature,
} from "@/product/saas/entitlements";
import { requireTenantContext } from "@/product/saas/tenant";
import { ApiKeyCreateButton } from "@/components/app/ApiKeyCreateButton";
import { BusinessFeaturesForm } from "@/components/app/BusinessFeaturesForm";
import { GmailSettings } from "@/components/app/GmailSettings";
import { SettingsIntegrationsForm } from "@/components/app/SettingsIntegrationsForm";
import { getGrowthStore } from "@/product/growth";
import { asNotice } from "@/product/gmail/http";
import {
  gmailConfigured,
  gmailPushConfigured,
  gmailWatchActive,
  readGmailEnv,
} from "@/product/gmail/oauth";
import { getGmailStore } from "@/product/gmail/runtime";

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
  const t = await getTranslations("app");
  const lang = locale === "fr" ? "fr" : "en";

  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  const included = featuresForPlan(auth.ctx.organization.plan);
  const locked = growthUpsellFeatures().filter(
    (f) => !orgHasFeature(auth.ctx.organization.plan, f),
  );
  const settings = await getGrowthStore().getOrgSettings(
    auth.ctx.organization.id,
  );
  const gmailAccount = await getGmailStore()
    .getAccount(auth.ctx.organization.id, auth.ctx.user.id)
    .catch(() => null);
  const gmailEnv = readGmailEnv();

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("settings.headline")}
        </h1>
        <p className="mt-2 text-navy/70">{t("settings.intro")}</p>
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
          {t("settings.plan")}
        </h2>
        <p className="mt-2 text-lg font-semibold text-navy">
          {auth.ctx.organization.plan === "growth"
            ? t("plan.growth")
            : t("plan.starter")}
        </p>
        <p className="mt-1 text-sm text-navy/60">
          {auth.ctx.organization.name} · {auth.ctx.user.email}
        </p>
        {auth.ctx.organization.accountType === "demo" ? (
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[rgb(120_60_0)]">
            {t("settings.demoAccount")}
          </p>
        ) : null}
        {auth.ctx.organization.city || auth.ctx.organization.industry ? (
          <p className="mt-2 text-sm text-navy/60">
            {[auth.ctx.organization.industry, auth.ctx.organization.city]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        {auth.ctx.organization.missedCallClientId ? (
          <p className="mt-2 text-xs text-navy/50">
            {t("settings.clientLinked")}:{" "}
            {auth.ctx.organization.missedCallClientId}
          </p>
        ) : (
          <p className="mt-2 text-sm text-navy/70">
            {t("dashboard.notLinked")}
          </p>
        )}
      </section>

      <section className="rounded-md border border-navy/10 bg-white px-5 py-4">
        <BusinessFeaturesForm
          organizationId={auth.ctx.organization.id}
          initial={auth.ctx.organization.features}
          canEdit={
            auth.ctx.membership.role === "owner" ||
            auth.ctx.membership.role === "admin" ||
            auth.ctx.isPlatformAdmin
          }
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
          {t("settings.included")}
        </h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {included.map((f) => (
            <li
              key={f}
              className="rounded-md border border-navy/10 bg-white px-3 py-2 text-sm text-navy"
            >
              {FEATURE_LABELS[f][lang]}
            </li>
          ))}
        </ul>
      </section>

      {locked.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
            {t("settings.growthOnly")}
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {locked.map((f) => (
              <li
                key={f}
                className="rounded-md border border-dashed border-navy/20 bg-white/60 px-3 py-2 text-sm text-navy/60"
              >
                {FEATURE_LABELS[f][lang]}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-md border border-navy/10 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
          {t("settings.integrations")}
        </h2>
        <p className="mt-2 text-sm text-navy/70">
          {t("settings.integrationsIntro")}
        </p>
        <p className="mt-2">
          <Link
            href="/app/settings/calendar"
            className="text-sm font-semibold text-navy underline"
          >
            {t("schedule.navCalendar")}
          </Link>
          {" · "}
          <Link
            href="/app/settings/notifications"
            className="text-sm font-semibold text-navy underline"
          >
            {t("alerts.settings")}
          </Link>
          {" · "}
          <Link
            href="/app/settings/security"
            className="text-sm font-semibold text-navy underline"
          >
            {t("security.headline")}
          </Link>
          {" · "}
          <Link
            href="/app/feedback"
            className="text-sm font-semibold text-navy underline"
          >
            {t("pilot.headline")}
          </Link>
          {" · "}
          <Link
            href="/app/settings/account"
            className="text-sm font-semibold text-navy underline"
          >
            {t("account.headline")}
          </Link>
          {" · "}
          <Link
            href="/app/support"
            className="text-sm font-semibold text-navy underline"
          >
            {t("support.headline")}
          </Link>
        </p>
        <SettingsIntegrationsForm
          initialNotifyEmail={settings.notifyEmail}
          initialGoogleReviewUrl={settings.googleReviewUrl}
          initialCrmWebhookUrl={settings.crmWebhookUrl}
          isGrowth={auth.ctx.organization.plan === "growth"}
        />
      </section>

      {orgHasFeature(auth.ctx.organization.plan, "WEBSITE_LEAD_CAPTURE") ? (
        <section className="rounded-md border border-navy/10 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
            {t("settings.apiKeyTitle")}
          </h2>
          <p className="mt-2 text-sm text-navy/70">
            {t("settings.apiKeyIntro")}
          </p>
          <ApiKeyCreateButton />
        </section>
      ) : null}
    </div>
  );
}
