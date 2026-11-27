import { getTranslations, setRequestLocale } from "next-intl/server";
import { AutomationSubnav } from "@/components/app/AutomationSubnav";
import { formatWhen } from "@/components/app/automation-copy";
import { usableTimeZone } from "@/product/scheduling/slots";
import { requireTenantContext } from "@/product/saas/tenant";
import { getAutomationServices } from "@/product/sms-automation/runtime";
import { isKnownResult } from "@/product/sms-automation/status";

export default async function AutomationHistoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.automations");
  const auth = await requireTenantContext();
  if (!auth.ok) return null;
  const history = await getAutomationServices().history(auth.ctx.organization.id);
  const timeZone = usableTimeZone(auth.ctx.organization.timezone);

  /** What happened to a text, in plain words. A code the screen does not know is never shown as it is. */
  function whatHappened(row: (typeof history)[number]): string[] {
    const lines: string[] = [];
    const reason = row.cancelReason ?? row.error;
    if (reason) lines.push(isKnownResult(reason) ? t(`results.${reason}`) : t("results.unknownError"));
    if (row.responseStatus !== "none") lines.push(t(`response.${row.responseStatus}`));
    return lines;
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-heading text-2xl font-extrabold text-navy">
          {t("historyTitle")}
        </h1>
        <p className="mt-2 max-w-2xl text-navy/70">{t("historyIntro")}</p>
      </header>
      <AutomationSubnav
        current="history"
        labels={{
          overview: t("subnav.overview"),
          missedCall: t("subnav.missedCall"),
          quotes: t("subnav.quotes"),
          templates: t("subnav.templates"),
          history: t("subnav.history"),
        }}
      />
      {history.length === 0 ? (
        <p className="rounded-md border border-dashed border-navy/20 bg-white px-4 py-8 text-center text-navy/60">
          {t("historyEmpty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-navy/10 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-navy/10 text-xs uppercase tracking-wide text-navy/50">
              <tr>
                <th className="px-4 py-3">{t("historyCols.customer")}</th>
                <th className="px-4 py-3">{t("historyCols.automation")}</th>
                <th className="px-4 py-3">{t("historyCols.status")}</th>
                <th className="px-4 py-3">{t("historyCols.result")}</th>
                <th className="px-4 py-3">{t("historyCols.message")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/10">
              {history.map((row) => (
                <tr key={row.jobId}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-navy">
                      {row.customerName || row.customerPhoneE164}
                    </p>
                    <p className="text-xs text-navy/50">{row.customerPhoneE164}</p>
                  </td>
                  <td className="px-4 py-3">{t(`names.${row.automationType}`)}</td>
                  <td className="px-4 py-3">
                    {t(`jobStatus.${row.status}`)}
                    {row.simulated ? ` · ${t("simulated")}` : ""}
                  </td>
                  <td className="px-4 py-3 text-navy/70">
                    {whatHappened(row).map((line) => (
                      <p key={line} className="m-0">
                        {line}
                      </p>
                    ))}
                    {row.providerMessageSid ? (
                      <p className="m-0 mt-1 text-xs text-navy/50">
                        {t("historyCols.reference")}: {row.providerMessageSid}
                      </p>
                    ) : null}
                    {row.price ? (
                      <p className="m-0 text-xs text-navy/50">
                        {t("historyCols.cost")}: {row.price} {row.priceUnit ?? ""}
                      </p>
                    ) : null}
                  </td>
                  <td className="max-w-xs px-4 py-3 text-navy/70">
                    {row.messageBody || "—"}
                    <p className="mt-1 text-xs text-navy/40">
                      {t("historyCols.scheduled")} {formatWhen(row.scheduledAt, locale, timeZone)}
                      {row.submittedAt
                        ? ` · ${t("historyCols.sent")} ${formatWhen(row.submittedAt, locale, timeZone)}`
                        : ""}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
