"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useFailureText } from "@/components/ui/FeedbackMessage";
import { BusyLabel } from "@/components/ui/Spinner";
import { classifyFailure } from "@/lib/client/use-action";
import { useGuarded } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
import { APP_CARD } from "@/components/app/card-classes";
type Msg = { role: "agent" | "system" | "user"; text: string };

const CARD = APP_CARD;
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
  const tFeedback = useTranslations("feedback");
  const failureText = useFailureText();
  const [language, setLanguage] = useState<"fr" | "en">("fr");
  const [scenario, setScenario] = useState<"open" | "after_hours">("open");
  const [state, setState] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [speech, setSpeech] = useState("");
  const [ended, setEnded] = useState(false);
  // "start" or "say" while a request runs: only that button shows its spinner.
  const [acting, setActing] = useState<"start" | "say" | null>(null);
  const busy = acting !== null;
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const callApi = useGuarded(callApiHandler);
  async function callApiHandler(body: Record<string, unknown>): Promise<boolean> {
    setActing(body.action === "say" ? "say" : "start");
    setError(null);
    try {
      const res = await timedFetch(
        `/api/businesses/${organizationId}/ai-receptionist/test`,
        {
          method: "POST",
          timeoutMs: 60_000,
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
        return false;
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
      return true;
    } catch (err) {
      // Without an answer the step may still have run: say so rather than "failed".
      const failure = classifyFailure(err, { write: true });
      setError(failure.outcomeUnknown ? failureText(failure) : t("error"));
      return false;
    } finally {
      setActing(null);
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
    if (busy || !state || !speech.trim()) return;
    const text = speech.trim();
    setMessages((prev) => [...prev, { role: "user", text }]);
    setSpeech("");
    const ok = await callApi({ action: "say", state, speech: text });
    if (ok === false) {
      // Keep what was typed: take the unanswered line back out of the conversation and into the box.
      setMessages((prev) => prev.slice(0, -1));
      setSpeech((current) => current || text);
    }
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
            aria-busy={acting === "start"}
            onClick={() => void start()}
          >
            <BusyLabel pending={acting === "start"} busyLabel={tFeedback("working")}>
              {t("start")}
            </BusyLabel>
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
          <button
            type="submit"
            className={BUTTON}
            disabled={busy || !speech.trim()}
            aria-busy={acting === "say"}
          >
            <BusyLabel pending={acting === "say"} busyLabel={tFeedback("sending")}>
              {t("send")}
            </BusyLabel>
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
