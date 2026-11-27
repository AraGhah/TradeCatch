"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { BusyLabel } from "@/components/ui/Spinner";
import {
  formatCallDuration,
  formatCallTime,
} from "@/product/receptionist/call-format";
import type { LiveTestInstructions } from "@/product/telephony/live-test-instructions";
import type {
  LiveTestScenario,
  SimulationRun,
} from "@/product/telephony/live-test";

import { useGuarded } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
import { APP_CARD } from "@/components/app/card-classes";
const CARD = APP_CARD;
const BUTTON =
  "rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
const BUTTON_GHOST =
  "rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-50";
const INPUT =
  "mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy";
const BADGE =
  "inline-flex items-center rounded-full border border-navy/20 bg-navy/5 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-navy";

const SCENARIOS: LiveTestScenario[] = [
  "answered_call",
  "missed_call",
  "caller_hangup",
  "receptionist_response",
  "routing_failure",
  "transfer_request",
  "appointment_request",
];

const STATUS_TONE: Record<string, string> = {
  completed: "text-green-700",
  transferred: "text-green-700",
  caller_hung_up: "text-amber-800",
  voicemail: "text-amber-800",
  failed: "text-red-700",
};

const CHECK_TONE = {
  ok: "text-green-700",
  warning: "text-amber-800",
  problem: "text-red-700",
} as const;

type ApiProblem = {
  code?: string;
  error?: string;
  details?: { fields?: string[] };
};

export function LivePhoneTesting({
  organizationId,
  initialLive,
  initialRuns,
  timeZone,
  loadFailed,
}: {
  organizationId: string;
  initialLive: LiveTestInstructions | null;
  initialRuns: SimulationRun[];
  timeZone: string;
  /** A part of the page could not be loaded on the server. */
  loadFailed: boolean;
}) {
  const t = useTranslations("app.livePhoneTesting");
  const lang = useLocale() === "fr" ? "fr" : "en";
  const [scenario, setScenario] = useState<LiveTestScenario>("receptionist_response");
  const [language, setLanguage] = useState<"fr" | "en">("fr");
  const [busy, setBusy] = useState<"simulation" | "live" | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [runs, setRuns] = useState<SimulationRun[]>(initialRuns);
  const [latest, setLatest] = useState<string | null>(null);
  const [live, setLive] = useState<LiveTestInstructions | null>(initialLive);

  const ringsFirst = live?.routing?.action === "ring_human";
  const missedNeedsRing = live?.routing != null && !ringsFirst;

  function describe(p: ApiProblem): string {
    const fields = p.details?.fields ?? [];
    const base =
      p.code && t.has(`errors.${p.code}`)
        ? t(`errors.${p.code}`)
        : p.error || t("error");
    // Name the settings that failed validation so the owner knows what to fix.
    return fields.length > 0
      ? `${base} ${t("fieldsLabel", { fields: fields.join(", ") })}`
      : base;
  }

  async function post(body: Record<string, unknown>) {
    const res = await timedFetch(`/api/businesses/${organizationId}/calls/test`, {
      method: "POST",
      timeoutMs: 60_000,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as
      | (ApiProblem & Record<string, unknown>)
      | null;
    return { ok: res.ok && data !== null && data.ok !== false, data };
  }

  const runSimulation = useGuarded(runSimulationHandler);
  async function runSimulationHandler() {
    setBusy("simulation");
    setProblem(null);
    try {
      const { ok, data } = await post({
        mode: "simulation",
        scenario,
        language,
        // One id per click: a retried request returns the saved run, never a second one.
        runId: crypto.randomUUID(),
      });
      if (!ok || !data?.run) {
        setProblem(data ?? {});
        return;
      }
      const run = data.run as SimulationRun;
      setRuns((prev) => [run, ...prev.filter((r) => r.callSid !== run.callSid)]);
      setLatest(run.callSid);
    } catch {
      setProblem({});
    } finally {
      setBusy(null);
    }
  }

  const recheckLive = useGuarded(recheckLiveHandler);
  /** Re-reads the line's readiness. This never places a call. */
  async function recheckLiveHandler() {
    setBusy("live");
    setProblem(null);
    try {
      const { ok, data } = await post({ mode: "live_instructions" });
      if (!ok || !data) {
        setProblem(data ?? {});
        return;
      }
      setLive(data as unknown as LiveTestInstructions);
    } catch {
      setProblem({});
    } finally {
      setBusy(null);
    }
  }

  const when = (iso: string) => formatCallTime(iso, timeZone, lang);
  const languageName = (code: string) =>
    t(`languageNames.${code === "en" ? "en" : "fr"}`);
  const eventLabel = (kind: string) =>
    t.has(`events.${kind}`) ? t(`events.${kind}`) : kind;

  return (
    <div className="flex flex-col gap-5">
      {loadFailed ? (
        <p
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {t("loadError")}
        </p>
      ) : null}

      <section className={CARD} aria-labelledby="sim-title">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="sim-title" className="text-sm font-semibold text-navy">
            {t("simTitle")}
          </h2>
          <span className={BADGE}>{t("simulatedBadge")}</span>
        </div>
        <p className="mt-1 text-xs text-navy/60">{t("simBadge")}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="text-xs text-navy/70">
            {t("scenario")}
            <select
              className={INPUT}
              value={scenario}
              onChange={(e) => setScenario(e.target.value as LiveTestScenario)}
            >
              {SCENARIOS.map((id) => (
                <option key={id} value={id} disabled={id === "missed_call" && missedNeedsRing}>
                  {t(`scenarios.${id}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-navy/70">
            {t("language")}
            <select
              className={INPUT}
              value={language}
              onChange={(e) => setLanguage(e.target.value === "en" ? "en" : "fr")}
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
        {missedNeedsRing ? (
          <p className="mt-2 text-xs text-navy/60">{t("needsRing")}</p>
        ) : null}
        <div className="mt-4">
          <button
            type="button"
            className={BUTTON}
            disabled={busy !== null}
            aria-busy={busy === "simulation"}
            onClick={() => void runSimulation()}
          >
            <BusyLabel pending={busy === "simulation"} busyLabel={t("running")}>
              {t("startSimulation")}
            </BusyLabel>
          </button>
        </div>
      </section>

      <section className={CARD} aria-labelledby="live-title">
        <h2 id="live-title" className="text-sm font-semibold text-navy">
          {t("liveTitle")}
        </h2>
        <p className="mt-1 text-xs text-navy/60">{t("liveIntro")}</p>
        <p
          role="note"
          className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {t("liveWarning")}
        </p>

        {live ? (
          <>
            <div className="mt-4">
              <p className="text-xs font-semibold text-navy/70">{t("testNumber")}</p>
              {live.numbers.length > 0 ? (
                <ul className="mt-1 space-y-1">
                  {live.numbers.map((n) => (
                    <li key={`${n.via}-${n.e164}`} className="text-sm text-navy">
                      <span className="font-mono">{n.e164}</span>
                      <span className="text-navy/60"> · {t(`numberVia.${n.via}`)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-red-700">{t("noNumber")}</p>
              )}
            </div>

            {live.routing ? (
              <div className="mt-4">
                <p className="text-xs font-semibold text-navy/70">{t("routingNow.title")}</p>
                <p className="mt-1 text-sm text-navy/80">
                  {t(`routingNow.${live.routing.action}`, {
                    last4: live.routing.ringTargetLast4 ?? "",
                    seconds: live.routing.ringTimeoutSeconds ?? 0,
                  })}{" "}
                  {live.routing.afterHours ? t("routingNow.afterHours") : null}
                </p>
                {live.routing.limitedByPlan ? (
                  <p className="mt-1 text-sm text-amber-800" role="note">
                    {t("routingNow.limitedByPlan")}
                  </p>
                ) : null}
              </div>
            ) : null}

            {live.expected ? (
              <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <p className="text-xs font-semibold text-navy/70 sm:col-span-2">
                  {t("expected.title")}
                </p>
                <div>
                  <dt className="inline font-semibold text-navy/70">{t("expected.receptionist")}: </dt>
                  <dd className="inline text-navy">
                    {live.expected.receptionistName ?? "—"} · {live.expected.businessName}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-navy/70">{t("expected.startsIn")}: </dt>
                  <dd className="inline text-navy">{languageName(live.expected.startLanguage)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="inline font-semibold text-navy/70">{t("expected.greeting")}: </dt>
                  <dd className="inline italic text-navy">“{live.expected.greeting}”</dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-navy/70">{t("expected.languages")}: </dt>
                  <dd className="inline text-navy">
                    {live.expected.languages.map(languageName).join(", ")}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-navy/70">{t("expected.voice")}: </dt>
                  <dd className="inline font-mono text-xs text-navy">{live.expected.voice}</dd>
                </div>
              </dl>
            ) : null}

            {live.dialNumber ? (
              <div className="mt-4">
                <p className="text-xs font-semibold text-navy/70">{t("steps.title")}</p>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-navy/80">
                  <li>{t("steps.dial", { number: live.dialNumber })}</li>
                  {live.expected ? (
                    <li>
                      {t("steps.listen", { language: languageName(live.expected.startLanguage) })}
                    </li>
                  ) : null}
                  <li>{t("steps.talk")}</li>
                  <li>{t("steps.review")}</li>
                </ol>
              </div>
            ) : null}

            <div className="mt-4">
              <p className="text-xs font-semibold text-navy/70">{t("checks.title")}</p>
              <ul className="mt-1 space-y-1">
                {live.checks.map((check) => (
                  <li key={check.code} className="text-sm text-navy/80">
                    <span className={`font-semibold ${CHECK_TONE[check.status]}`}>
                      {t(`checks.status.${check.status}`)}
                    </span>{" "}
                    {t(`checks.items.${check.code}`)}
                  </li>
                ))}
              </ul>
              <p
                className={`mt-2 text-sm font-medium ${live.ready ? "text-green-700" : "text-red-700"}`}
              >
                {live.ready ? t("checks.ready") : t("checks.notReady")}
              </p>
            </div>
          </>
        ) : null}

        <div className="mt-4">
          <button
            type="button"
            className={BUTTON_GHOST}
            disabled={busy !== null}
            aria-busy={busy === "live"}
            onClick={() => void recheckLive()}
          >
            <BusyLabel pending={busy === "live"} busyLabel={t("checking")}>
              {t("liveInstructions")}
            </BusyLabel>
          </button>
        </div>
      </section>

      {problem ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {describe(problem)}
        </p>
      ) : null}

      <section aria-labelledby="runs-title" aria-live="polite" className="flex flex-col gap-3">
        <h2 id="runs-title" className="text-sm font-semibold text-navy">
          {t("savedTitle")}
        </h2>
        {runs.length === 0 ? (
          <p className="rounded-md border border-dashed border-navy/20 bg-white px-4 py-6 text-center text-sm text-navy/60">
            {t("noRuns")}
          </p>
        ) : (
          runs.map((run) => (
            <article
              key={run.callSid}
              className={`${CARD} ${run.callSid === latest ? "ring-2 ring-navy/30" : ""}`}
            >
              <header className="flex flex-wrap items-center gap-2">
                <span className={BADGE}>{t("simulatedBadge")}</span>
                <h3 className="text-sm font-semibold text-navy">
                  {t(`scenarios.${run.scenario}`)}
                </h3>
                <span className={`text-sm font-semibold ${STATUS_TONE[run.finalStatus] ?? "text-navy"}`}>
                  {t(`status.${run.finalStatus}`)}
                </span>
              </header>
              <p className="mt-1 font-mono text-[11px] text-navy/50">{run.callSid}</p>

              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="inline font-semibold text-navy/70">{t("fields.started")}: </dt>
                  <dd className="inline text-navy">{when(run.startedAt)}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-navy/70">{t("fields.duration")}: </dt>
                  <dd className="inline text-navy">{formatCallDuration(run.durationSeconds)}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-navy/70">{t("fields.routing")}: </dt>
                  <dd className="inline text-navy">
                    {t(`routing.${run.routing.action}`)}
                    {run.routing.ringTargetLast4 ? ` (…${run.routing.ringTargetLast4})` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-navy/70">{t("fields.ended")}: </dt>
                  <dd className="inline text-navy">
                    {t(`termination.${run.termination.reason}`)}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-navy/70">{t("fields.languageHeld")}: </dt>
                  <dd className="inline text-navy">
                    {languageName(run.receptionist.callLanguage)}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-navy/70">{t("fields.voice")}: </dt>
                  <dd className="inline font-mono text-xs text-navy">{run.receptionist.voice}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="inline font-semibold text-navy/70">{t("fields.greeting")}: </dt>
                  <dd className="inline italic text-navy">
                    {run.receptionist.greeting ? `“${run.receptionist.greeting}”` : t("fields.none")}
                  </dd>
                </div>
              </dl>

              {run.notes.map((note) => (
                <p key={note} className="mt-2 text-xs text-amber-800">
                  {t.has(`notes.${note}`) ? t(`notes.${note}`) : note}
                </p>
              ))}
              {run.headline ? (
                <p className="mt-2 text-sm font-medium text-navy">{run.headline}</p>
              ) : null}

              <h4 className="mt-4 text-xs font-semibold text-navy/70">{t("timeline")}</h4>
              <ol className="mt-1 space-y-1 border-l border-navy/15 pl-3 text-xs text-navy/80">
                {run.events.map((ev) => (
                  <li key={ev.seq}>
                    <time dateTime={ev.at} className="font-mono text-navy/50">
                      +{ev.offsetSeconds}s
                    </time>{" "}
                    <span className="font-semibold">{eventLabel(ev.kind)}</span>
                    {ev.detail ? (
                      <span className="font-mono text-navy/60"> · {ev.detail}</span>
                    ) : null}{" "}
                    <span className={BADGE}>{t("simulatedBadge")}</span>
                  </li>
                ))}
              </ol>

              {run.transcript.length > 0 ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-navy/70">
                    {t("transcript")} ({run.transcript.length})
                  </summary>
                  <ol className="mt-2 flex flex-col gap-1 text-xs">
                    {run.transcript.map((line, i) => (
                      <li key={i} className={line.speaker === "caller" ? "text-navy" : "text-navy/60"}>
                        <span className="font-semibold">
                          {line.speaker === "caller" ? t("caller") : t("receptionistRole")}:
                        </span>{" "}
                        {line.text}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
