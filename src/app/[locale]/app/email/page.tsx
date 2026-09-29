import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { orgHasFeature } from "@/product/saas/entitlements";
import {
  getEmailAutomationServices,
  getEmailAutomationStore,
} from "@/product/email-automation/runtime";
import { EmailAutomationPanel } from "@/components/app/EmailAutomationPanel";

export default async function AppEmailPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app");

  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  if (!orgHasFeature(auth.ctx.organization.plan, "EMAIL_AUTOMATION")) {
    return <p className="text-navy/70">{t("email.entitlement")}</p>;
  }

  const orgId = auth.ctx.organization.id;
  await getEmailAutomationServices().ensureDefaults(orgId);
  const store = getEmailAutomationStore();
  const [templates, sequences, enrollments, settings] = await Promise.all([
    store.listTemplates(orgId),
    store.listSequences(orgId),
    store.listEnrollments(orgId, 100),
    store.getOrgSettings(orgId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("email.headline")}
        </h1>
        <p className="mt-2 text-navy/70">{t("email.intro")}</p>
      </header>
      <EmailAutomationPanel
        locale={locale === "fr" ? "fr" : "en"}
        templates={templates}
        sequences={sequences}
        enrollments={enrollments}
        autoEnrollSequenceId={settings.autoEnrollSequenceId}
      />
    </div>
  );
}
