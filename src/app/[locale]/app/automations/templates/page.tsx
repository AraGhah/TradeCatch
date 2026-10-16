import { getTranslations, setRequestLocale } from "next-intl/server";
import { AutomationSubnav } from "@/components/app/AutomationSubnav";
import { TemplateManager } from "@/components/app/TemplateManager";
import { requireTenantContext } from "@/product/saas/tenant";
import { getAutomationServices } from "@/product/sms-automation/runtime";
import { TEMPLATE_KEYS, type TemplateKey } from "@/product/sms-automation/types";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.automations");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  const templates = await getAutomationServices().listTemplates(auth.ctx.organization.id);
  const names = Object.fromEntries(
    TEMPLATE_KEYS.map((key) => [key, t(`templates.${key}`)]),
  ) as Record<TemplateKey, string>;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("templatesTitle")}
        </h1>
        <p className="mt-2 max-w-2xl text-navy/70">{t("templatesIntro")}</p>
      </header>
      <AutomationSubnav
        current="templates"
        labels={{
          overview: t("subnav.overview"),
          missedCall: t("subnav.missedCall"),
          quotes: t("subnav.quotes"),
          templates: t("subnav.templates"),
          history: t("subnav.history"),
        }}
      />
      <TemplateManager
        organizationId={auth.ctx.organization.id}
        templates={templates}
        labels={{
          language: t("fields.language"),
          variables: t("templateUi.variables"),
          preview: t("templateUi.preview"),
          save: t("save"),
          reset: t("templateUi.reset"),
          chars: t("templateUi.chars"),
          segments: t("templateUi.segments"),
          segmentWarning: t("templateUi.segmentWarning"),
          saved: t("saved"),
          error: t("error"),
          missing: t("templateUi.missing"),
          names,
        }}
      />
    </div>
  );
}
