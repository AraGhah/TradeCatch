import { getTranslations, setRequestLocale } from "next-intl/server";
import { AutomationBoard } from "@/components/app/AutomationBoard";
import { AutomationSubnav } from "@/components/app/AutomationSubnav";
import { describeSchedule, formatWhen, type Translate } from "@/components/app/automation-copy";
import { usableTimeZone } from "@/product/scheduling/slots";
import { requireTenantContext } from "@/product/saas/tenant";
import { getAutomationServices } from "@/product/sms-automation/runtime";
import { loadStatusInputs } from "@/product/sms-automation/status-input";
import { AUTOMATION_TYPES, type AutomationType } from "@/product/sms-automation/types";

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
  const organizationId = auth.ctx.organization.id;
  const automations = await getAutomationServices().list(organizationId);
  const status = await loadStatusInputs(organizationId);

  const translate = t as unknown as Translate;
  const timeZone = usableTimeZone(auth.ctx.organization.timezone);
  const schedule = Object.fromEntries(
    AUTOMATION_TYPES.map((type) => {
      const automation = automations.find((row) => row.type === type);
      return [type, automation ? describeSchedule(automation, translate, locale) : []];
    }),
  ) as Record<AutomationType, string[]>;
  const lastAt = Object.fromEntries(
    AUTOMATION_TYPES.map((type) => [
      type,
      formatWhen(automations.find((row) => row.type === type)?.lastExecutionAt, locale, timeZone),
    ]),
  ) as Record<AutomationType, string | null>;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-heading text-2xl font-extrabold text-navy">
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
      <section aria-labelledby="automation-how" className="rounded-md border border-navy/10 bg-white p-4">
        <h2 id="automation-how" className="font-semibold text-navy">
          {t("how.title")}
        </h2>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-navy/80">
          <li>{t("how.onOff")}</li>
          <li>{t("how.consent")}</li>
          <li>{t("how.recheck")}</li>
          <li>{t("how.timing")}</li>
        </ul>
      </section>
      <AutomationBoard
        organizationId={organizationId}
        automations={automations}
        status={status}
        schedule={schedule}
        lastAt={lastAt}
      />
      <p className="text-xs text-navy/60">{t("card.statsNote")}</p>
    </div>
  );
}
