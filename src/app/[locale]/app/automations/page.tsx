import { getTranslations, setRequestLocale } from "next-intl/server";
import { AutomationBoard } from "@/components/app/AutomationBoard";
import { AutomationSubnav } from "@/components/app/AutomationSubnav";
import { requireTenantContext } from "@/product/saas/tenant";
import { getAutomationServices } from "@/product/sms-automation/runtime";
import type { AutomationType } from "@/product/sms-automation/types";

const TYPES: AutomationType[] = [
  "missed_call_recovery",
  "quote_followup",
  "appointment_reminder",
  "customer_reengagement",
  "urgent_lead_notification",
];

export default async function AutomationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.automations");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  const automations = await getAutomationServices().list(auth.ctx.organization.id);
  const names = Object.fromEntries(
    TYPES.map((type) => [type, t(`names.${type}`)]),
  ) as Record<AutomationType, string>;
  const triggers = Object.fromEntries(
    TYPES.map((type) => [type, t(`triggers.${type}`)]),
  ) as Record<AutomationType, string>;
  const actions = Object.fromEntries(
    TYPES.map((type) => [type, t(`actions.${type}`)]),
  ) as Record<AutomationType, string>;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("headline")}
        </h1>
        <p className="mt-2 max-w-2xl text-navy/70">{t("intro")}</p>
      </header>
      <AutomationSubnav
        current="overview"
        labels={{
          overview: t("subnav.overview"),
          missedCall: t("subnav.missedCall"),
          quotes: t("subnav.quotes"),
          templates: t("subnav.templates"),
          history: t("subnav.history"),
        }}
      />
      <AutomationBoard
        organizationId={auth.ctx.organization.id}
        automations={automations}
        labels={{
          automation: t("table.automation"),
          status: t("table.status"),
          trigger: t("table.trigger"),
          action: t("table.action"),
          active: t("active"),
          inactive: t("inactive"),
          enable: t("enable"),
          disable: t("disable"),
          edit: t("edit"),
          test: t("test"),
          history: t("subnav.history"),
          last: t("table.last"),
          success: t("table.success"),
          failures: t("table.failures"),
          responses: t("table.responses"),
          none: t("none"),
          later: t("later"),
          names,
          triggers,
          actions,
          error: t("error"),
        }}
      />
    </div>
  );
}
