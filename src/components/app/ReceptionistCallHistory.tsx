"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CustomerRecordCard, type RecordPriority } from "./CustomerRecordCard";
import { cleanProblemText, formatPhoneDisplay } from "@/product/crm/record-quality";

type CallRow = {
  id: string;
  callSid: string;
  simulated?: boolean;
  fromE164: string;
  language: string;
  status: string;
  outcome?: string;
  urgency?: string;
  summary?: {
    headline?: string;
    issue?: string;
    callerName?: string;
    nextStep?: string;
    aiSummary?: string;
    knownContact?: string;
  };
  slots?: {
    callerName?: string;
    callbackE164?: string;
    service?: string;
    project?: string;
    issue?: string;
    message?: string;
    email?: string;
    serviceAddress?: string;
    location?: string;
    preferredTime?: string;
  };
  appointment?: { status?: string; label?: string };
  durationSeconds?: number;
  startedAt: string;
  transfers?: unknown[];
};

type TurnRow = { speaker: "agent" | "caller"; text: string };

const CARD = "overflow-hidden rounded-md border border-navy/10 bg-white";

/** Call urgency as the owner reads it: emergency, high, medium. */
function priorityOf(urgency: string | undefined): RecordPriority {
  if (urgency === "critical") return "urgent";
  if (urgency === "priority") return "high";
  if (urgency === "routine") return "medium";
  return null;
}

/**
 * The raw conversation, kept apart from the summary above it and only fetched
 * when the owner asks (it is subject to the plan's transcript and retention rules).
 */
function Conversation({
  organizationId,
  callId,
}: {
  organizationId: string;
  callId: string;
}) {
  const t = useTranslations("app.record");
  const [state, setState] = useState<
    "idle" | "loading" | "error" | { turns: TurnRow[] }
  >("idle");

  async function load() {
    setState("loading");
    try {
      const res = await fetch(
        `/api/businesses/${organizationId}/ai-receptionist/calls/${encodeURIComponent(callId)}`,
      );
      const data = (await res.json().catch(() => null)) as {
        call?: { transcript?: TurnRow[] };
      } | null;
      if (!res.ok) return setState("error");
      setState({ turns: data?.call?.transcript ?? [] });
    } catch {
      setState("error");
    }
  }

  if (state === "idle" || state === "loading" || state === "error") {
    return (
      <div>
        <button
          type="button"
          className="font-semibold text-navy underline disabled:opacity-50"
          disabled={state === "loading"}
          onClick={() => void load()}
        >
          {t("conversation")}
        </button>
        {state === "error" ? (
          <p role="alert" className="mt-1 text-red-700">
            {t("conversationEmpty")}
          </p>
        ) : null}
      </div>
    );
  }
  return state.turns.length === 0 ? (
    <p className="m-0">{t("conversationEmpty")}</p>
  ) : (
    <div>
      <p className="m-0 font-semibold">{t("conversation")}</p>
      <ul className="m-0 mt-1 list-none space-y-1 p-0">
        {state.turns.map((turn, i) => (
          <li key={i}>
            <span className="font-semibold">
              {turn.speaker === "agent" ? t("receptionist") : t("caller")}:{" "}
            </span>
            {turn.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReceptionistCallHistory({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useTranslations("app.receptionist.history");
  const tr = useTranslations("app.record");
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/businesses/${organizationId}/ai-receptionist/calls`,
        );
        const data = (await res.json().catch(() => null)) as {
          calls?: CallRow[];
          error?: string;
        } | null;
        if (!res.ok) {
          if (!cancelled) setError(data?.error || t("error"));
          return;
        }
        if (!cancelled) setCalls(data?.calls ?? []);
      } catch {
        if (!cancelled) setError(t("error"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, t]);

  if (loading) {
    return <p className="text-sm text-navy/60">{t("loading")}</p>;
  }
  if (error) {
    return (
      <p role="alert" className="text-sm text-red-700">
        {error}
      </p>
    );
  }
  if (calls.length === 0) {
    return <p className="text-sm text-navy/60">{t("empty")}</p>;
  }

  const labels = {
    service: tr("service"),
    problem: tr("problem"),
    address: tr("address"),
    appointment: tr("appointment"),
    notes: tr("notes"),
    notProvided: tr("notProvided"),
    moreDetails: tr("moreDetails"),
    lessDetails: tr("lessDetails"),
  };

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-navy">{t("title")}</h2>
      {calls.map((c) => {
        const slots = c.slots ?? {};
        const problem = cleanProblemText(
          slots.issue ?? slots.project ?? slots.message ?? c.summary?.issue,
        );
        const phone = slots.callbackE164 ?? c.fromE164;
        const priority = priorityOf(c.urgency);
        const preferred = slots.preferredTime?.trim();
        const appointment =
          c.appointment?.status === "booked" && c.appointment.label
            ? c.appointment.label
            : c.appointment?.label || preferred
              ? tr("requested", { time: c.appointment?.label || preferred! })
              : tr("notScheduled");
        const minutes = c.durationSeconds != null ? Math.floor(c.durationSeconds / 60) : null;
        const meta = [
          new Date(c.startedAt).toLocaleString(),
          minutes != null ? `${t("duration")}: ${minutes}m ${c.durationSeconds! % 60}s` : "",
          c.simulated ? t("simulated") : "",
        ]
          .filter(Boolean)
          .join(" · ");
        const notes = [slots.email, c.summary?.aiSummary, c.summary?.nextStep]
          .filter(Boolean)
          .join(" ");
        return (
          <div key={c.id} className={CARD}>
            <CustomerRecordCard
              name={
                slots.callerName ||
                c.summary?.callerName ||
                (phone && phone !== "anonymous"
                  ? formatPhoneDisplay(phone)
                  : tr("unknownCaller"))
              }
              phone={
                phone && phone !== "anonymous" ? formatPhoneDisplay(phone) : undefined
              }
              service={slots.service ?? slots.project}
              problem={problem || undefined}
              address={slots.serviceAddress ?? slots.location}
              appointment={appointment}
              priority={priority}
              priorityLabel={priority ? tr(`priority.${priority}`) : undefined}
              meta={meta}
              labels={labels}
              details={
                <>
                  {notes ? (
                    <p className="m-0">
                      <span className="font-semibold">{tr("notes")}: </span>
                      {notes}
                    </p>
                  ) : null}
                  <Conversation organizationId={organizationId} callId={c.id} />
                </>
              }
            />
          </div>
        );
      })}
    </div>
  );
}
