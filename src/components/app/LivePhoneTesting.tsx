"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

const CARD = "rounded-md border border-navy/10 bg-white px-4 py-4";
const BUTTON =
  "rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
const BUTTON_GHOST =
  "rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-50";
const INPUT =
  "mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy";

type Scenario =
  | "ai_answers"
  | "human_first_missed_then_ai"
  | "transfer_request"
  | "appointment_request";

export function LivePhoneTesting({
  organizationId,
  dialNumber,
}: {
  organizationId: string;
  dialNumber?: string | null;
}) {
  const t = useTranslations("app.livePhoneTesting");
  const [scenario, setScenario] = useState<Scenario>("ai_answers");
  const [language, setLanguage] = useState<"fr" | "en">("fr");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    messages?: string[];
    events?: { kind: string; detail?: string }[];
    callSid?: string;
    summary?: { headline?: string; outcome?: string };
    warning?: string;
    instructions?: string[];
    dialNumber?: string | null;
  } | null>(null);

  async function run(mode: "simulation" | "live_instructions") {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/businesses/${organizationId}/calls/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, scenario, language }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        messages?: string[];
        events?: { kind: string; detail?: string }[];
        callSid?: string;
        summary?: { headline?: string; outcome?: string };
        warning?: string;
        instructions?: string[];
        dialNumber?: string | null;
      } | null;
      if (!res.ok || !data) {
        setError(data?.error || t("error"));
        return;
      }
      setResult(data);
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className={CARD}>
        <h2 className="text-sm font-semibold text-navy">{t("simTitle")}</h2>
        <p className="mt-1 text-xs text-navy/60">{t("simBadge")}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="text-xs text-navy/70">
            {t("scenario")}
            <select
              className={INPUT}
              value={scenario}
              onChange={(e) => setScenario(e.target.value as Scenario)}
            >
              <option value="ai_answers">{t("scenarios.ai_answers")}</option>
              <option value="human_first_missed_then_ai">
                {t("scenarios.human_first_missed_then_ai")}
              </option>
              <option value="transfer_request">
                {t("scenarios.transfer_request")}
              </option>
              <option value="appointment_request">
                {t("scenarios.appointment_request")}
              </option>
            </select>
          </label>
          <label className="text-xs text-navy/70">
            {t("language")}
            <select
              className={INPUT}
              value={language}
              onChange={(e) =>
                setLanguage(e.target.value === "en" ? "en" : "fr")
              }
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={BUTTON}
            disabled={busy}
            onClick={() => void run("simulation")}
          >
            {t("startSimulation")}
          </button>
          <button
            type="button"
            className={BUTTON_GHOST}
            disabled={busy}
            onClick={() => void run("live_instructions")}
          >
            {t("liveInstructions")}
          </button>
        </div>
        <p className="mt-2 text-xs text-navy/50">{t("liveWarning")}</p>
        {dialNumber ? (
          <p className="mt-1 font-mono text-xs text-navy/70">
            {t("testNumber")}: {dialNumber}
          </p>
        ) : null}
      </section>

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {result ? (
        <section className={CARD}>
          <h3 className="text-sm font-semibold text-navy">{t("results")}</h3>
          {result.warning ? (
            <p className="mt-2 text-sm text-amber-800">{result.warning}</p>
          ) : null}
          {result.instructions ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-navy/80">
              {result.instructions.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : null}
          {result.callSid ? (
            <p className="mt-2 font-mono text-xs text-navy/50">
              {result.callSid}
            </p>
          ) : null}
          {result.events?.length ? (
            <ol className="mt-3 space-y-1 text-xs text-navy/70">
              {result.events.map((ev, i) => (
                <li key={i}>
                  <span className="font-semibold">{ev.kind}</span>
                  {ev.detail ? ` — ${ev.detail}` : ""}
                </li>
              ))}
            </ol>
          ) : null}
          {result.messages?.length ? (
            <div className="mt-3 max-h-64 overflow-y-auto rounded-md bg-navy/[0.03] p-3 text-sm text-navy/80">
              {result.messages.map((m, i) => (
                <p key={i} className="mb-1">
                  {m}
                </p>
              ))}
            </div>
          ) : null}
          {result.summary?.headline ? (
            <p className="mt-3 text-sm font-medium text-navy">
              {result.summary.headline}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
