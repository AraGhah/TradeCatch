"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { CustomerRecordCard, type RecordPriority } from "./CustomerRecordCard";
import { isWithheldCaller } from "@/lib/phone";
import { cleanProblemText, formatPhoneDisplay } from "@/product/crm/record-quality";
import {
  formatCallDuration,
  formatCallTime,
} from "@/product/receptionist/call-format";

import { LoadingRegion, SkeletonRows } from "@/components/ui/Skeleton";
import { BusyLabel } from "@/components/ui/Spinner";
import { timedFetch } from "@/lib/client/timed-fetch";
import { APP_LIST_CARD } from "@/components/app/card-classes";
type CallRow = {
  id: string;
  callSid: string;
  simulated?: boolean;
  fromE164: string;
  language: string;
  status: string;
  /** In progress, completed, missed, not answered, failed (see callState). */
  state?: string;
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

const CARD = APP_LIST_CARD;

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

  // One load at a time: the button is disabled while it runs, and this closes the
  // gap before React re-renders for a burst of clicks in the same instant.
  const loadingNow = useRef(false);
  async function load() {
    if (loadingNow.current) return;
    loadingNow.current = true;
    setState("loading");
    try {
      const res = await timedFetch(
        `/api/businesses/${organizationId}/ai-receptionist/calls/${encodeURIComponent(callId)}`,
      );
      const data = (await res.json().catch(() => null)) as {
        call?: { transcript?: TurnRow[] };
      } | null;
      if (!res.ok) return setState("error");
      setState({ turns: data?.call?.transcript ?? [] });
    } catch {
      setState("error");
    } finally {
      loadingNow.current = false;
    }
  }

  if (state === "idle" || state === "loading" || state === "error") {
    return (
      <div>
        <button
          type="button"
          className="font-semibold text-navy underline disabled:opacity-50"
          disabled={state === "loading"}
          aria-busy={state === "loading"}
          onClick={() => void load()}
        >
          <BusyLabel pending={state === "loading"} busyLabel={t("conversationLoading")}>
            {t("conversation")}
          </BusyLabel>
        </button>
        {state === "error" ? (
          <p role="alert" className="mt-1 text-red-700">
            {t("conversationError")}
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
  const tc = useTranslations("app.calls");
  const tFeedback = useTranslations("feedback");
  const lang = useLocale() === "fr" ? "fr" : "en";
  const [calls, setCalls] = useState<CallRow[]>([]);
  // Calls are stored in UTC and shown in the business's own time zone.
  const [timeZone, setTimeZone] = useState("America/Toronto");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped by "Try again" to read the list once more (a read, so safe to repeat).
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await timedFetch(
          `/api/businesses/${organizationId}/ai-receptionist/calls`,
        );
        const data = (await res.json().catch(() => null)) as {
          calls?: CallRow[];
          timezone?: string;
          error?: string;
        } | null;
        if (!res.ok) {
          if (!cancelled) setError(data?.error || t("error"));
          return;
        }
        if (!cancelled) {
          if (data?.timezone) setTimeZone(data.timezone);
          setCalls(data?.calls ?? []);
        }
      } catch {
        if (!cancelled) setError(t("error"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, t, reloadKey]);

  if (loading) {
    return (
      <LoadingRegion label={t("loading")}>
        <SkeletonRows rows={3} columns={3} />
      </LoadingRegion>
    );
  }
  if (error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm text-red-700">
        <p className="m-0">{error}</p>
        <button
          type="button"
          className="rounded-md border border-red-300 px-3 py-1.5 font-semibold"
          onClick={() => {
            setError(null);
            setReloadKey((n) => n + 1);
          }}
        >
          {tFeedback("retry")}
        </button>
      </div>
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
        const duration = formatCallDuration(c.durationSeconds);
        const hasNumber = Boolean(phone) && !isWithheldCaller(phone);
        const meta = [
          formatCallTime(c.startedAt, timeZone, lang),
          // A handled call reads as its outcome in the card; any other state
          // (missed, not answered, failed, ...) is named here.
          c.state && c.state !== "completed" ? tc(`state.${c.state}`) : "",
          duration ? `${t("duration")}: ${duration}` : "",
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
                (hasNumber ? formatPhoneDisplay(phone) : tr("unknownCaller"))
              }
              phone={hasNumber ? formatPhoneDisplay(phone) : undefined}
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
