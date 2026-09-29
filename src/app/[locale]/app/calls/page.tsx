import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { orgHasFeature } from "@/product/saas/entitlements";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { OUTCOME_LABEL } from "@/product/receptionist/summary";
import type { CallSession } from "@/product/receptionist/types";

export default async function AppCallsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app");
  const lang = locale === "fr" ? "fr" : "en";

  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  if (!orgHasFeature(auth.ctx.organization.plan, "MISSED_CALL_RECOVERY")) {
    return <p className="text-navy/70">{t("calls.entitlement")}</p>;
  }

  const clientId = auth.ctx.organization.missedCallClientId;
  let calls: CallSession[] = [];
  let configured = false;
  if (clientId) {
    try {
      const runtime = getReceptionistRuntime();
      await runtime.refresh();
      configured = runtime.configs.some((c) => c.clientAccountId === clientId);
      calls = await runtime.store.listSessions({ clientAccountId: clientId, limit: 100 });
    } catch {
      calls = [];
    }
  }

  const stats = {
    total: calls.length,
    afterHours: calls.filter((c) => c.afterHours).length,
    transfers: calls.filter(
      (c) => c.outcome === "transferred" || c.outcome === "emergency_transferred",
    ).length,
    emergencies: calls.filter((c) => c.urgency?.level === "critical").length,
    requests: calls.filter(
      (c) => c.outcome === "message_taken" || c.outcome === "appointment_requested",
    ).length,
  };

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(lang === "fr" ? "fr-CA" : "en-CA");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("calls.headline")}
        </h1>
        <p className="mt-2 text-navy/70">{t("calls.intro")}</p>
      </header>

      {!clientId ? (
        <p className="text-sm text-navy/70">{t("dashboard.notLinked")}</p>
      ) : !configured ? (
        <p className="text-sm text-navy/70">{t("calls.notConfigured")}</p>
      ) : null}

      {calls.length > 0 ? (
        <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(
            ["total", "afterHours", "transfers", "emergencies", "requests"] as const
          ).map((key) => (
            <div
              key={key}
              className="rounded-md border border-navy/10 bg-white px-4 py-3"
            >
              <dt className="text-xs text-navy/60">{t(`calls.stats.${key}`)}</dt>
              <dd className="m-0 mt-1 text-2xl font-extrabold text-navy">
                {stats[key]}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {calls.length === 0 ? (
        <p className="rounded-md border border-dashed border-navy/20 bg-white px-4 py-8 text-center text-navy/60">
          {t("calls.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-navy/10 overflow-hidden rounded-md border border-navy/10 bg-white">
          {calls.map((call) => {
            const s = call.summary;
            const outcome = call.outcome ? OUTCOME_LABEL[call.outcome][lang] : t("calls.inProgress");
            return (
              <li key={call.id} className="px-4 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-navy">
                    {call.urgency?.level === "critical" ? "🚨 " : ""}
                    {call.slots.callerName || call.fromE164}
                  </p>
                  <p className="text-xs text-navy/70">{fmt(call.startedAt)}</p>
                </div>
                <p className="mt-1 text-sm text-navy/70">
                  {outcome}
                  {call.afterHours ? ` · ${t("calls.afterHours")}` : ""}
                  {call.durationSeconds ? ` · ${call.durationSeconds}s` : ""}
                </p>
                {call.slots.issue ? (
                  <p className="mt-2 text-sm text-navy">{call.slots.issue}</p>
                ) : null}
                {s?.knownContact ? (
                  <p className="mt-1 text-xs font-semibold text-navy/70">
                    {t("calls.knownContact")}: {s.knownContact}
                  </p>
                ) : null}
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-navy/70 sm:grid-cols-2">
                  {call.slots.callbackE164 ? (
                    <div>
                      <dt className="inline font-semibold">{t("calls.callback")}: </dt>
                      <dd className="inline">{call.slots.callbackE164}</dd>
                    </div>
                  ) : null}
                  {call.slots.serviceAddress ? (
                    <div>
                      <dt className="inline font-semibold">{t("calls.address")}: </dt>
                      <dd className="inline">{call.slots.serviceAddress}</dd>
                    </div>
                  ) : null}
                  {call.slots.preferredTime ? (
                    <div>
                      <dt className="inline font-semibold">{t("calls.preferredTime")}: </dt>
                      <dd className="inline">{call.slots.preferredTime}</dd>
                    </div>
                  ) : null}
                  {s?.nextStep ? (
                    <div className="sm:col-span-2">
                      <dt className="inline font-semibold">{t("calls.nextStep")}: </dt>
                      <dd className="inline">{s.nextStep}</dd>
                    </div>
                  ) : null}
                </dl>
                {s?.aiSummary ? (
                  <p className="mt-2 text-sm italic text-navy/80">{s.aiSummary}</p>
                ) : null}
                {call.turns.length > 0 ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-navy/70">
                      {t("calls.transcript")} ({call.turns.length})
                    </summary>
                    <ol className="mt-2 flex flex-col gap-1 text-xs">
                      {call.turns
                        .filter((turn) => turn.speaker !== "system")
                        .map((turn, i) => (
                          <li key={i} className={turn.speaker === "caller" ? "text-navy" : "text-navy/60"}>
                            <span className="font-semibold">
                              {turn.speaker === "caller" ? t("calls.caller") : t("calls.agent")}:
                            </span>{" "}
                            {turn.text}
                          </li>
                        ))}
                    </ol>
                  </details>
                ) : call.transcriptPurgedAt ? (
                  <p className="mt-2 text-xs text-navy/70">{t("calls.purged")}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
