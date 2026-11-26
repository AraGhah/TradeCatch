import { formatPhone, isWithheldCaller } from "@/lib/phone";
import { getMissedCallReadStore } from "@/product/missed-call/runtime";
import { loadCallFeed } from "@/product/receptionist/call-feed";
import { callState } from "@/product/receptionist/call-history-view";
import {
  formatCallDuration,
  formatCallTime,
} from "@/product/receptionist/call-format";
import { receptionistErrorCode } from "@/product/receptionist/diagnostics";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireTenantContext } from "@/product/saas/tenant";
import { orgHasFeature } from "@/product/saas/entitlements";
import { voiceCapabilitiesForPlan } from "@/product/receptionist/plan-limits";
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

  const showTranscripts = voiceCapabilitiesForPlan(
    auth.ctx.organization.plan,
  ).transcripts;
  const clientId = auth.ctx.organization.missedCallClientId;
  let calls: CallSession[] = [];
  let configured = false;
  // Dates are shown in the business's own time zone, not the server's (UTC).
  let timeZone = "America/Toronto";
  // A failed load is not an empty history: say so, never show "no calls yet".
  let loadFailed = false;
  // The receptionist's calls loaded but the missed-call text-back list did not.
  let partial = false;
  if (clientId) {
    try {
      const runtime = getReceptionistRuntime();
      await runtime.refresh();
      const config = runtime.configs.find((c) => c.clientAccountId === clientId);
      configured = Boolean(config);
      if (config?.timezone) timeZone = config.timezone;
      // Both call paths, for this business only (the id comes from the session).
      const feed = await loadCallFeed({
        clientAccountId: clientId,
        receptionist: runtime.store,
        missedCall: getMissedCallReadStore,
        limit: 100,
      });
      calls = feed.calls;
      partial = feed.missedCallsUnavailable;
    } catch (err) {
      loadFailed = true;
      calls = [];
      console.error(
        JSON.stringify({
          event: "tradecatch.calls.page_load_failed",
          errorCode: receptionistErrorCode(err),
        }),
      );
    }
  }

  const stats = {
    total: calls.length,
    afterHours: calls.filter((c) => c.afterHours).length,
    emergencies: calls.filter((c) => c.urgency?.level === "critical").length,
    requests: calls.filter(
      (c) =>
        c.outcome === "message_taken" ||
        c.outcome === "appointment_requested" ||
        c.outcome === "appointment_booked",
    ).length,
  };

  const fmt = (iso: string) => formatCallTime(iso, timeZone, lang);
  const who = (number: string | undefined) =>
    !number || isWithheldCaller(number)
      ? t("calls.unknownCaller")
      : formatPhone(number);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-extrabold text-navy">
            {t("calls.headline")}
          </h1>
          <p className="mt-2 text-navy/70">{t("calls.intro")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/app/calls/settings"
            className="rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy hover:bg-navy/5"
          >
            {t("calls.phoneSettings")}
          </Link>
          <Link
            href="/app/test-center/live-phone"
            className="rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy hover:bg-navy/5"
          >
            {t("calls.liveTesting")}
          </Link>
        </div>
      </header>

      {!clientId ? (
        <p className="text-sm text-navy/70">{t("dashboard.notLinked")}</p>
      ) : loadFailed ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {t("calls.loadError")}
        </p>
      ) : !configured ? (
        <p className="text-sm text-navy/70">{t("calls.notConfigured")}</p>
      ) : null}

      {partial && !loadFailed ? (
        <p
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {t("calls.partialError")}
        </p>
      ) : null}

      {calls.length > 0 ? (
        <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            ["total", "afterHours", "emergencies", "requests"] as const
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

      {loadFailed ? null : calls.length === 0 ? (
        <p className="rounded-md border border-dashed border-navy/20 bg-white px-4 py-8 text-center text-navy/60">
          {t("calls.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-navy/10 overflow-hidden rounded-md border border-navy/10 bg-white">
          {calls.map((call) => {
            const s = call.summary;
            const state = callState(call);
            // A handled call reads as what happened in it; every other state
            // is named by itself (missed, not answered, failed, ...).
            const outcome =
              state === "completed" && call.outcome
                ? OUTCOME_LABEL[call.outcome][lang]
                : t(`calls.state.${state}`);
            const duration = formatCallDuration(call.durationSeconds);
            return (
              <li key={call.id} className="px-4 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-navy">
                    {call.urgency?.level === "critical" ? "🚨 " : ""}
                    {call.slots.callerName || who(call.fromE164)}
                  </p>
                  <p className="text-xs text-navy/70">
                    <time dateTime={call.startedAt}>{fmt(call.startedAt)}</time>
                  </p>
                </div>
                {call.slots.callerName && !isWithheldCaller(call.fromE164) ? (
                  <p className="mt-0.5 text-xs text-navy/70">{who(call.fromE164)}</p>
                ) : null}
                <p className="mt-1 text-sm text-navy/70">
                  {outcome}
                  {call.afterHours ? ` · ${t("calls.afterHours")}` : ""}
                  {duration ? ` · ${duration}` : ""}
                  {call.toE164 ? ` · ${t("calls.calledNumber")} ${formatPhone(call.toE164)}` : ""}
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
                      <dd className="inline">{formatPhone(call.slots.callbackE164)}</dd>
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
                {showTranscripts && call.turns.length > 0 ? (
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
                ) : showTranscripts && call.transcriptPurgedAt ? (
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
