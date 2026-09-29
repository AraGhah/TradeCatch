"use client";

import { useEffect, useRef, useState } from "react";
import { CallSummaryCard } from "@/components/CallSummaryCard";
import { IllustrativeBadge } from "@/components/IllustrativeBadge";
import { OUTCOME_LABEL } from "@/product/receptionist/summary";
import type { DemoMessage, DemoResponse } from "@/product/receptionist/demo";

export type CallDemoCopy = {
  eyebrow: string;
  title: string;
  intro: string;
  badge: string;
  startHeading: string;
  scenarios: { id: "open" | "after_hours"; label: string; hint: string }[];
  startCta: string;
  inputLabel: string;
  inputPlaceholder: string;
  send: string;
  suggestionsLabel: string;
  suggestions: Record<string, string[]>;
  agentLabel: string;
  callerLabel: string;
  systemLabel: string;
  afterHoursNote: string;
  ended: string;
  restart: string;
  error: string;
  rateLimited: string;
  expired: string;
  summaryLabel: string;
  summaryPlaceholder: string;
  summaryBadge: string;
  fields: {
    caller: string;
    callback: string;
    address: string;
    request: string;
    time: string;
    urgency: string;
    outcome: string;
    nextStep: string;
    contact: string;
  };
  urgency: Record<string, string>;
};

type Line = { role: "agent" | "caller" | "system"; text: string };

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 focus-visible:ring-offset-2";

export function CallDemo({
  copy,
  locale,
}: {
  copy: CallDemoCopy;
  locale: "fr" | "en";
}) {
  const [scenario, setScenario] = useState<"open" | "after_hours">("open");
  const [lines, setLines] = useState<Line[]>([]);
  const [state, setState] = useState<string | null>(null);
  const [step, setStep] = useState<string>("reason");
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [summary, setSummary] = useState<DemoResponse["summary"]>();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  async function call(
    body: Record<string, unknown>,
  ): Promise<DemoResponse | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/receptionist/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as
        (DemoResponse & { code?: string }) | null;
      if (!res.ok || !data) {
        setError(
          res.status === 429
            ? copy.rateLimited
            : res.status === 410
              ? copy.expired
              : copy.error,
        );
        if (res.status === 410) setEnded(true);
        return null;
      }
      return data;
    } catch {
      setError(copy.error);
      return null;
    } finally {
      setBusy(false);
    }
  }

  function absorb(data: DemoResponse) {
    const incoming: Line[] = data.messages.map((m: DemoMessage) => ({
      role: m.role,
      text: m.text,
    }));
    setLines((prev) => [...prev, ...incoming]);
    setState(data.state);
    setStep(data.step);
    setEnded(data.ended);
    if (data.summary) setSummary(data.summary);
  }

  async function start() {
    setLines([]);
    setSummary(undefined);
    setEnded(false);
    setStarted(true);
    const data = await call({ action: "start", language: locale, scenario });
    if (data) {
      absorb(data);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setStarted(false);
    }
  }

  async function send(text: string) {
    const speech = text.trim();
    if (!speech || !state || busy || ended) return;
    setInput("");
    setLines((prev) => [...prev, { role: "caller", text: speech }]);
    const data = await call({ action: "say", state, speech });
    if (data) absorb(data);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const suggestions = !ended && started ? (copy.suggestions[step] ?? []) : [];
  const label = (role: Line["role"]) =>
    role === "agent"
      ? copy.agentLabel
      : role === "caller"
        ? copy.callerLabel
        : copy.systemLabel;

  const summaryFields = summary
    ? [
        {
          label: copy.fields.caller,
          value: summary.callerName ?? summary.callerE164,
        },
        summary.callbackE164
          ? { label: copy.fields.callback, value: summary.callbackE164 }
          : null,
        summary.serviceAddress
          ? { label: copy.fields.address, value: summary.serviceAddress }
          : null,
        (summary.issue ?? summary.message)
          ? {
              label: copy.fields.request,
              value: (summary.issue ?? summary.message)!,
            }
          : null,
        summary.preferredTime
          ? { label: copy.fields.time, value: summary.preferredTime }
          : null,
        summary.knownContact
          ? { label: copy.fields.contact, value: summary.knownContact }
          : null,
        {
          label: copy.fields.urgency,
          value: copy.urgency[summary.urgency] ?? summary.urgency,
        },
        {
          label: copy.fields.outcome,
          value: OUTCOME_LABEL[summary.outcome][locale],
        },
        { label: copy.fields.nextStep, value: summary.nextStep },
      ].filter((f): f is { label: string; value: string } => f !== null)
    : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="flex flex-col border border-[rgb(var(--ink-rgb)/0.12)] bg-surface shadow-[0_28px_56px_-40px_rgb(var(--ink-rgb)/0.5)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgb(var(--ink-rgb)/0.1)] px-5 py-3">
          <IllustrativeBadge label={copy.badge} />
        </div>

        {!started ? (
          <div className="flex flex-col gap-5 px-5 py-6">
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-3 font-mono text-[10.5px] tracking-[0.1em] text-muted uppercase">
                {copy.startHeading}
              </legend>
              <div className="flex flex-col gap-3 sm:flex-row">
                {copy.scenarios.map((s) => (
                  <label
                    key={s.id}
                    className={`flex flex-1 cursor-pointer flex-col gap-1 border px-4 py-3 ${
                      scenario === s.id
                        ? "border-navy bg-[rgb(var(--ink-rgb)/0.05)]"
                        : "border-[rgb(var(--ink-rgb)/0.15)]"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[15px] font-semibold text-heading">
                      <input
                        type="radio"
                        name="demo-scenario"
                        value={s.id}
                        checked={scenario === s.id}
                        onChange={() => setScenario(s.id)}
                        className="accent-[rgb(var(--ink-rgb))]"
                      />
                      {s.label}
                    </span>
                    <span className="pl-6 text-[13px] text-muted">
                      {s.hint}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <button
                type="button"
                onClick={() => void start()}
                disabled={busy}
                className={`rounded-md bg-navy px-5 py-3 text-[15px] font-semibold text-white disabled:opacity-60 ${FOCUS}`}
              >
                {copy.startCta}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              ref={logRef}
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              tabIndex={0}
              className="h-[clamp(300px,42vh,420px)] overflow-y-auto px-5 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 focus-visible:ring-inset"
            >
              <ol className="m-0 flex list-none flex-col gap-3 p-0">
                {lines.map((line, i) => (
                  <li
                    key={i}
                    className={
                      line.role === "caller"
                        ? "ml-auto max-w-[85%]"
                        : line.role === "system"
                          ? "mx-auto max-w-[95%]"
                          : "mr-auto max-w-[85%]"
                    }
                  >
                    <p className="mb-1 font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
                      {label(line.role)}
                    </p>
                    <p
                      className={`m-0 px-4 py-2.5 text-[15px] leading-[1.5] ${
                        line.role === "caller"
                          ? "bg-navy text-white"
                          : line.role === "system"
                            ? "border border-dashed border-[rgb(var(--ink-rgb)/0.25)] text-[13.5px] text-muted italic"
                            : "border border-[rgb(var(--ink-rgb)/0.12)] bg-paper text-heading"
                      }`}
                    >
                      {line.text}
                    </p>
                  </li>
                ))}
                {busy ? (
                  <li className="mr-auto text-muted" aria-hidden>
                    …
                  </li>
                ) : null}
              </ol>
            </div>

            {error ? (
              <p
                role="alert"
                className="mx-5 mb-3 border border-red-300 bg-red-50 px-3 py-2 text-[13.5px] text-red-800"
              >
                {error}
              </p>
            ) : null}

            {ended ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(var(--ink-rgb)/0.1)] px-5 py-4">
                <p className="m-0 text-[14px] font-semibold text-heading">
                  {copy.ended}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setStarted(false);
                    setLines([]);
                    setError(null);
                  }}
                  className={`rounded-md border border-[rgb(var(--ink-rgb)/0.25)] px-4 py-2 text-[14px] font-semibold text-heading hover:bg-[rgb(var(--ink-rgb)/0.05)] ${FOCUS}`}
                >
                  {copy.restart}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 border-t border-[rgb(var(--ink-rgb)/0.1)] px-5 py-4">
                {suggestions.length > 0 ? (
                  <div>
                    <p className="mb-2 font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
                      {copy.suggestionsLabel}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          disabled={busy}
                          onClick={() => void send(s)}
                          className={`border border-[rgb(var(--ink-rgb)/0.2)] px-3 py-1.5 text-left text-[13.5px] text-heading hover:bg-[rgb(var(--ink-rgb)/0.05)] disabled:opacity-60 ${FOCUS}`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(input);
                  }}
                >
                  <label className="sr-only" htmlFor="demo-input">
                    {copy.inputLabel}
                  </label>
                  <input
                    id="demo-input"
                    ref={inputRef}
                    value={input}
                    maxLength={400}
                    autoComplete="off"
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={copy.inputPlaceholder}
                    disabled={busy}
                    className={`min-w-0 flex-1 border border-[rgb(var(--ink-rgb)/0.25)] bg-white px-3 py-2.5 text-[15px] text-heading ${FOCUS}`}
                  />
                  <button
                    type="submit"
                    disabled={busy || !input.trim()}
                    className={`rounded-md bg-navy px-4 py-2.5 text-[14px] font-semibold text-white disabled:opacity-50 ${FOCUS}`}
                  >
                    {copy.send}
                  </button>
                </form>
                {scenario === "after_hours" ? (
                  <p className="m-0 text-[12.5px] text-muted">
                    {copy.afterHoursNote}
                  </p>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>

      <div>
        {summary ? (
          <CallSummaryCard
            cardLabel={copy.summaryLabel}
            sampleBadge={copy.summaryBadge}
            fields={summaryFields}
          />
        ) : (
          <div className="flex h-full min-h-[200px] items-center border border-dashed border-[rgb(var(--ink-rgb)/0.25)] px-6 py-8 text-[15px] leading-[1.55] text-muted">
            {copy.summaryPlaceholder}
          </div>
        )}
      </div>
    </div>
  );
}
