"use client";

import { useEffect, useRef, useState } from "react";
import { CallSummaryCard } from "@/components/CallSummaryCard";
import { CTAButton } from "@/components/CTAButton";
import { IllustrativeBadge } from "@/components/IllustrativeBadge";
import { useDemoVoice, type VoiceFailure } from "@/components/useDemoVoice";
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
  summaryLabel: string;
  summaryPlaceholder: string;
  summaryBadge: string;
  afterCall: { title: string; body: string; cta: string };
  voice: {
    modeLabel: string;
    speak: string;
    speakHint: string;
    type: string;
    typeHint: string;
    unsupported: string;
    privacy: string;
    micStart: string;
    micStop: string;
    listening: string;
    speaking: string;
    repliesAloud: string;
    denied: string;
    noSpeech: string;
    unavailable: string;
  };
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
type Scenario = "open" | "after_hours";

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 focus-visible:ring-offset-2";

/** Five bars that move while the microphone or the receptionist is active. */
function Equalizer({ active }: { active: boolean }) {
  return (
    <span aria-hidden className="inline-flex h-4 items-end gap-[3px]">
      {[0.55, 1, 0.7, 0.9, 0.45].map((scale, i) => (
        <span
          key={i}
          className={`block w-[3px] origin-bottom bg-orange ${
            active ? "animate-[demo-bars_0.9s_ease-in-out_infinite]" : ""
          }`}
          style={{
            height: `${Math.round(scale * 16)}px`,
            animationDelay: `${i * 0.11}s`,
          }}
        />
      ))}
    </span>
  );
}

function MicIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

export function CallDemo({
  copy,
  locale,
}: {
  copy: CallDemoCopy;
  locale: "fr" | "en";
}) {
  const voice = useDemoVoice(locale);
  const [scenario, setScenario] = useState<Scenario>("open");
  const [lines, setLines] = useState<Line[]>([]);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [summary, setSummary] = useState<DemoResponse["summary"]>();
  const [step, setStep] = useState<string>("reason");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // What the visitor picked on the start screen, and the live voice state.
  const [wantsVoice, setWantsVoice] = useState(true);
  const [voiceLive, setVoiceLive] = useState(false);
  const [repliesAloud, setRepliesAloud] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Conversation facts live in refs so voice callbacks never read stale state.
  const turnsRef = useRef<string[]>([]);
  const scenarioRef = useRef<Scenario>("open");
  const busyRef = useRef(false);
  const endedRef = useRef(false);
  const voiceLiveRef = useRef(false);
  const repliesAloudRef = useRef(false);
  const silentTurnsRef = useRef(0);

  const voiceChoice = voice.canListen && wantsVoice;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  function setLive(value: boolean) {
    voiceLiveRef.current = value;
    setVoiceLive(value);
  }

  function setAloud(value: boolean) {
    repliesAloudRef.current = value;
    setRepliesAloud(value);
  }

  /** Stops the microphone and any speech; `reason` explains why, if it failed. */
  function stopVoice(reason?: VoiceFailure) {
    setLive(false);
    voice.stopListening();
    voice.cancelSpeech();
    setNotice(
      reason === "denied"
        ? copy.voice.denied
        : reason === "no_speech"
          ? copy.voice.noSpeech
          : reason === "unavailable"
            ? copy.voice.unavailable
            : null,
    );
  }

  function listenForCaller() {
    voice.listen({
      onFinal: (text) => {
        silentTurnsRef.current = 0;
        void send(text);
      },
      onFail: (reason) => {
        if (!voiceLiveRef.current || endedRef.current) return;
        if (reason !== "no_speech") {
          stopVoice(reason);
          return;
        }
        // Browsers close the microphone after a few quiet seconds. Try once
        // more, then hand control back instead of listening forever.
        silentTurnsRef.current += 1;
        if (silentTurnsRef.current >= 2) stopVoice("no_speech");
        else listenForCaller();
      },
    });
  }

  function afterReply(data: DemoResponse) {
    const resume = () => {
      if (data.ended) setLive(false);
      else if (voiceLiveRef.current) listenForCaller();
    };
    if (!repliesAloudRef.current && !voiceLiveRef.current) return;
    const spoken = data.messages
      .filter((m) => m.role === "agent")
      .map((m) => m.text);
    if (repliesAloudRef.current) voice.speak(spoken, resume);
    else resume();
  }

  async function call(
    body: Record<string, unknown>,
  ): Promise<DemoResponse | null> {
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/receptionist/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as DemoResponse | null;
      if (!res.ok || !data) {
        setError(res.status === 429 ? copy.rateLimited : copy.error);
        return null;
      }
      return data;
    } catch {
      setError(copy.error);
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function absorb(data: DemoResponse) {
    const incoming: Line[] = data.messages.map((m: DemoMessage) => ({
      role: m.role,
      text: m.text,
    }));
    setLines((prev) => [...prev, ...incoming]);
    setStep(data.step);
    endedRef.current = data.ended;
    setEnded(data.ended);
    if (data.summary) setSummary(data.summary);
    afterReply(data);
  }

  async function start(chosen: Scenario) {
    stopVoice();
    scenarioRef.current = chosen;
    turnsRef.current = [];
    endedRef.current = false;
    silentTurnsRef.current = 0;
    setScenario(chosen);
    setLines([]);
    setSummary(undefined);
    setEnded(false);
    setStarted(true);
    setLive(voiceChoice);
    setAloud(voiceChoice && voice.canSpeak);
    if (voiceChoice) voice.prime();

    const data = await call({
      action: "start",
      language: locale,
      scenario: chosen,
    });
    if (data) {
      absorb(data);
      if (!voiceChoice) setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      stopVoice();
      setStarted(false);
    }
  }

  async function send(text: string) {
    const speech = text.trim();
    if (!speech || busyRef.current || endedRef.current) return;
    voice.cancelSpeech();
    voice.stopListening();
    setInput("");
    setLines((prev) => [...prev, { role: "caller", text: speech }]);

    const data = await call({
      action: "say",
      language: locale,
      scenario: scenarioRef.current,
      history: turnsRef.current,
      speech,
    });
    if (data) {
      turnsRef.current = [...turnsRef.current, speech];
      absorb(data);
    } else {
      stopVoice();
    }
    if (!voiceLiveRef.current) setTimeout(() => inputRef.current?.focus(), 0);
  }

  function toggleMic() {
    if (voiceLiveRef.current) {
      stopVoice();
      return;
    }
    silentTurnsRef.current = 0;
    setNotice(null);
    setLive(true);
    voice.prime();
    listenForCaller();
  }

  function reset() {
    stopVoice();
    setStarted(false);
    setLines([]);
    setError(null);
  }

  const suggestions = !ended && started ? (copy.suggestions[step] ?? []) : [];
  const label = (role: Line["role"]) =>
    role === "agent"
      ? copy.agentLabel
      : role === "caller"
        ? copy.callerLabel
        : copy.systemLabel;

  const status = voice.listening
    ? copy.voice.listening
    : voice.speaking
      ? copy.voice.speaking
      : null;

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
          <div className="flex flex-col gap-6 px-5 py-6">
            {voice.ready ? (
              voice.canListen ? (
                <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                  <legend className="mb-2 p-0 font-mono text-[10.5px] tracking-[0.1em] text-muted uppercase">
                    {copy.voice.modeLabel}
                  </legend>
                  <div className="inline-flex w-fit border border-[rgb(var(--ink-rgb)/0.25)]">
                    {(
                      [
                        ["speak", copy.voice.speak],
                        ["type", copy.voice.type],
                      ] as const
                    ).map(([id, text]) => {
                      const active = (id === "speak") === voiceChoice;
                      return (
                        <label
                          key={id}
                          className={`flex cursor-pointer items-center gap-2 px-4 py-2.5 text-[14.5px] font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-orange has-[:focus-visible]:ring-inset ${
                            active
                              ? "bg-navy text-white"
                              : "text-heading hover:bg-[rgb(var(--ink-rgb)/0.05)]"
                          }`}
                        >
                          <input
                            type="radio"
                            name="demo-mode"
                            value={id}
                            checked={active}
                            onChange={() => setWantsVoice(id === "speak")}
                            className="sr-only"
                          />
                          {id === "speak" ? <MicIcon /> : null}
                          {text}
                        </label>
                      );
                    })}
                  </div>
                  <p className="m-0 max-w-[40em] text-[13px] leading-[1.5] text-muted">
                    {voiceChoice ? copy.voice.speakHint : copy.voice.typeHint}
                    {voiceChoice ? ` ${copy.voice.privacy}` : ""}
                  </p>
                </fieldset>
              ) : (
                <p className="m-0 border border-dashed border-[rgb(var(--ink-rgb)/0.25)] px-4 py-3 text-[13.5px] leading-[1.5] text-muted">
                  {copy.voice.unsupported}
                </p>
              )
            ) : null}

            <div className="flex flex-col gap-3">
              <p
                id="demo-scenario-heading"
                className="m-0 font-mono text-[10.5px] tracking-[0.1em] text-muted uppercase"
              >
                {copy.startHeading}
              </p>
              <div
                role="group"
                aria-labelledby="demo-scenario-heading"
                className="flex flex-col gap-3 sm:flex-row"
              >
                {copy.scenarios.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void start(s.id)}
                    className={`flex flex-1 flex-col items-start gap-1 border border-[rgb(var(--ink-rgb)/0.15)] px-4 py-3 text-left hover:border-navy hover:bg-[rgb(var(--ink-rgb)/0.05)] disabled:opacity-60 ${FOCUS}`}
                  >
                    <span className="text-[15px] font-semibold text-heading">
                      {s.label}
                    </span>
                    <span className="text-[13px] text-muted">{s.hint}</span>
                    <span className="mt-1 text-[13.5px] font-semibold text-navy">
                      {copy.startCta} <span aria-hidden>→</span>
                    </span>
                  </button>
                ))}
              </div>
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
                  onClick={reset}
                  className={`rounded-md border border-[rgb(var(--ink-rgb)/0.25)] px-4 py-2 text-[14px] font-semibold text-heading hover:bg-[rgb(var(--ink-rgb)/0.05)] ${FOCUS}`}
                >
                  {copy.restart}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 border-t border-[rgb(var(--ink-rgb)/0.1)] px-5 py-4">
                {voice.canListen || voice.canSpeak ? (
                  <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <p
                      role="status"
                      className="m-0 flex items-center gap-2.5 text-[13.5px] font-semibold text-heading"
                    >
                      <Equalizer active={Boolean(status)} />
                      {status ?? notice}
                    </p>
                    {voice.canSpeak ? (
                      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted">
                        <input
                          type="checkbox"
                          checked={repliesAloud}
                          onChange={(e) => {
                            setAloud(e.target.checked);
                            if (!e.target.checked) voice.cancelSpeech();
                            else voice.prime();
                          }}
                          className="h-4 w-4 accent-[rgb(var(--ink-rgb))]"
                        />
                        {copy.voice.repliesAloud}
                      </label>
                    ) : null}
                  </div>
                ) : null}

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
                  {voice.canListen ? (
                    <button
                      type="button"
                      onClick={toggleMic}
                      disabled={busy}
                      aria-pressed={voiceLive}
                      aria-label={
                        voiceLive ? copy.voice.micStop : copy.voice.micStart
                      }
                      title={voiceLive ? copy.voice.micStop : copy.voice.micStart}
                      className={`relative flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full disabled:opacity-50 ${FOCUS} ${
                        voiceLive
                          ? "animate-tc-pulse-ember bg-orange text-navy"
                          : "bg-navy text-white hover:bg-navy-light"
                      }`}
                    >
                      <MicIcon />
                    </button>
                  ) : null}
                  <label className="sr-only" htmlFor="demo-input">
                    {copy.inputLabel}
                  </label>
                  <input
                    id="demo-input"
                    ref={inputRef}
                    value={voice.listening && voice.interim ? voice.interim : input}
                    readOnly={voice.listening}
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
          <div className="flex flex-col gap-4">
            <CallSummaryCard
              cardLabel={copy.summaryLabel}
              sampleBadge={copy.summaryBadge}
              fields={summaryFields}
            />
            <div className="relative border border-[rgb(var(--ink-rgb)/0.12)] bg-surface p-[clamp(20px,2.4vw,28px)] pl-[clamp(24px,2.8vw,32px)]">
              <span
                aria-hidden
                className="absolute top-0 left-0 h-full w-[3px] bg-orange"
              />
              <p className="m-0 font-heading text-[clamp(19px,1.9vw,23px)] leading-[1.2] font-extrabold tracking-[-0.03em] text-heading">
                {copy.afterCall.title}
              </p>
              <p className="mt-3 mb-0 text-[15px] leading-[1.6] text-muted">
                {copy.afterCall.body}
              </p>
              <CTAButton
                href={{
                  pathname: "/book-audit",
                  query: { plan: "receptionist" },
                }}
                variant="ember"
                className="mt-5"
              >
                {copy.afterCall.cta}
              </CTAButton>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-[200px] items-center border border-dashed border-[rgb(var(--ink-rgb)/0.25)] px-6 py-8 text-[15px] leading-[1.55] text-muted">
            {copy.summaryPlaceholder}
          </div>
        )}
      </div>
    </div>
  );
}
