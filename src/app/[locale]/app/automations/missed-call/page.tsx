import { getTranslations, setRequestLocale } from "next-intl/server";
import { AutomationSettingsForm } from "@/components/app/AutomationSettingsForm";
import { AutomationSubnav } from "@/components/app/AutomationSubnav";
import { AutomationTestPanel } from "@/components/app/AutomationTestPanel";
import { requireTenantContext } from "@/product/saas/tenant";
import { getAutomationServices } from "@/product/sms-automation/runtime";

export default async function MissedCallAutomationPage({
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
  const automation = automations.find((row) => row.type === "missed_call_recovery");
  if (!automation) return null;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("names.missed_call_recovery")}
        </h1>
        <p className="mt-2 max-w-2xl text-navy/70">{t("missedIntro")}</p>
      </header>
      <AutomationSubnav
        current="missedCall"
        labels={{
          overview: t("subnav.overview"),
          missedCall: t("subnav.missedCall"),
          quotes: t("subnav.quotes"),
          templates: t("subnav.templates"),
          history: t("subnav.history"),
        }}
      />
      <AutomationSettingsForm
        organizationId={auth.ctx.organization.id}
        automation={automation}
        labels={{
          save: t("save"),
          saved: t("saved"),
          error: t("error"),
          status: t("table.status"),
          active: t("active"),
          inactive: t("inactive"),
          enable: t("enable"),
          disable: t("disable"),
          delay: t("fields.delay"),
          secondDelay: t("fields.secondDelay"),
          language: t("fields.language"),
          languageCustomer: t("fields.languageCustomer"),
          languageEn: t("fields.languageEn"),
          languageFr: t("fields.languageFr"),
          attempts: t("fields.attempts"),
          windowStart: t("fields.windowStart"),
          windowEnd: t("fields.windowEnd"),
          weekend: t("fields.weekend"),
          duplicate: t("fields.duplicate"),
          stopReply: t("fields.stopReply"),
          stopHuman: t("fields.stopHuman"),
          stopAccepted: t("fields.stopAccepted"),
          stopRejected: t("fields.stopRejected"),
          minutes: t("fields.minutes"),
        }}
      />
      <AutomationTestPanel
        organizationId={auth.ctx.organization.id}
        missedCallId={automation.id}
        labels={{
          title: t("testPanel.title"),
          intro: t("testPanel.intro"),
          missed: t("testPanel.missed"),
          run: t("testPanel.run"),
          reply: t("testPanel.reply"),
          quote: t("testPanel.quote"),
          accept: t("testPanel.accept"),
          result: t("testPanel.result"),
          error: t("error"),
          phone: t("testPanel.phone"),
          name: t("testPanel.name"),
        }}
      />
    </div>
  );
}
