"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

type Msg = { role: "agent" | "system" | "user"; text: string };

const CARD = "rounded-md border border-navy/10 bg-white px-4 py-4";
const BUTTON =
  "rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
const BUTTON_GHOST =
  "rounded-md border border-navy/20 px-3 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-50";
const INPUT =
  "mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-navy";

export function ReceptionistTestPanel({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useTranslations("app.receptionist.test");
  const [language, setLanguage] = useState<"fr" | "en">("fr");
  const [scenario, setScenario] = useState<"open" | "after_hours">("open");
  const [state, setState] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [speech, setSpeech] = useState("");
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function callApi(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/businesses/${organizationId}/ai-receptionist/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        messages?: { role: "agent" | "system"; text: string }[];
        state?: string | null;
        ended?: boolean;
        summary?: { headline?: string; aiSummary?: string; outcome?: string };
      } | null;
      if (!res.ok || !data) {
        setError(data?.error || t("error"));
        return;
      }
      setMessages((prev) => [
        ...prev,
        ...(data.messages ?? []).map((m) => ({
          role: m.role,
          text: m.text,
        })),
      ]);
      setState(data.state ?? null);
      setEnded(Boolean(data.ended));
      if (data.summary) {
        setSummary(
          data.summary.headline ||
            data.summary.aiSummary ||
            data.summary.outcome ||
            null,
        );
      }
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setMessages([]);
    setSummary(null);
    setEnded(false);
    setState(null);
    await callApi({ action: "start", language, scenario });
  }

  async function say(e: React.FormEvent) {
    e.preventDefault();
    if (!state || !speech.trim()) return;
    const text = speech.trim();
    setMessages((prev) => [...prev, { role: "user", text }]);
    setSpeech("");
    await callApi({ action: "say", state, speech: text });
  }

  return (
    <section className={`${CARD} flex flex-col gap-4`}>
      <div>
        <h2 className="text-sm font-semibold text-navy">{t("title")}</h2>
        <p className="mt-1 text-xs text-navy/60">{t("badge")}</p>
      </div>

      {!state && !ended ? (
        <div className="flex flex-wrap items-end gap-3">
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
          <label className="text-xs text-navy/70">
            {t("scenario")}
            <select
              className={INPUT}
              value={scenario}
              onChange={(e) =>
                setScenario(
                  e.target.value === "after_hours" ? "after_hours" : "open",
                )
              }
            >
              <option value="open">{t("scenarioOpen")}</option>
              <option value="after_hours">{t("scenarioAfter")}</option>
            </select>
          </label>
          <button
            type="button"
            className={BUTTON}
            disabled={busy}
            onClick={() => void start()}
          >
            {t("start")}
          </button>
        </div>
      ) : null}

      <div className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-md bg-navy/[0.03] p-3">
        {messages.length === 0 ? (
          <p className="text-xs text-navy/50">{t("empty")}</p>
        ) : (
          messages.map((m, i) => (
            <p
              key={i}
              className={`text-sm ${
                m.role === "user"
                  ? "text-navy font-medium"
                  : m.role === "system"
                    ? "text-navy/50 italic"
                    : "text-navy/80"
              }`}
            >
              <span className="text-xs uppercase tracking-wide text-navy/40">
                {m.role === "user"
                  ? t("you")
                  : m.role === "system"
                    ? t("system")
                    : t("ai")}
                :{" "}
              </span>
              {m.text}
            </p>
          ))
        )}
      </div>

      {state && !ended ? (
        <form onSubmit={(e) => void say(e)} className="flex gap-2">
          <input
            className={INPUT}
            value={speech}
            onChange={(e) => setSpeech(e.target.value)}
            placeholder={t("placeholder")}
            disabled={busy}
            maxLength={400}
          />
          <button type="submit" className={BUTTON} disabled={busy || !speech.trim()}>
            {t("send")}
          </button>
        </form>
      ) : null}

      {ended ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-navy/70">{t("ended")}</p>
          {summary ? (
            <p className="text-sm font-medium text-navy">{summary}</p>
          ) : null}
          <button type="button" className={BUTTON_GHOST} onClick={() => void start()}>
            {t("restart")}
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
