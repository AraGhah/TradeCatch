"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type {
  ConversationControl,
  CrmMessage,
  LeadPriority,
  LeadStatus,
  LeadWithCustomer,
} from "@/product/crm/types";

import { useAttemptKey } from "@/lib/client/attempt-key";
import { classifyFailure } from "@/lib/client/use-action";
import { useGuarded } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
import { useFailureText } from "@/components/ui/FeedbackMessage";
import { BusyLabel } from "@/components/ui/Spinner";
type Person = { id: string; name: string };

const STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "appointment_booked",
  "quote_sent",
  "won",
  "lost",
  "closed",
];

const PRIORITIES: LeadPriority[] = ["urgent", "high", "medium", "low"];

const CONTROLS: ConversationControl[] = [
  "ai_managed",
  "human_managed",
  "automation_paused",
  "closed",
];

export function LeadWorkspace({
  organizationId,
  lead,
  events,
  messages,
  control,
  people,
  timeZone,
}: {
  organizationId: string;
  lead: LeadWithCustomer;
  events: { id: string; kind: string; detail?: string; at: string }[];
  messages: CrmMessage[];
  control: ConversationControl;
  people: Person[];
  /** The business's timezone: history times are shown the way the owner lives them. */
  timeZone?: string;
}) {
  const t = useTranslations("app.crm");
  const tFeedback = useTranslations("feedback");
  const dateLocale = useLocale() === "fr" ? "fr-CA" : "en-CA";
  const eventTime = (iso: string) => {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return iso;
    try {
      return new Intl.DateTimeFormat(dateLocale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: timeZone || "America/Toronto",
      }).format(at);
    } catch {
      return new Intl.DateTimeFormat(dateLocale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/Toronto",
      }).format(at);
    }
  };
  const router = useRouter();
  const [status, setStatus] = useState(lead.status);
  const [priority, setPriority] = useState(lead.priority);
  const [assigned, setAssigned] = useState(lead.assignedToUserId ?? "");
  const [service, setService] = useState(lead.service ?? "");
  const [description, setDescription] = useState(lead.description ?? "");
  const [location, setLocation] = useState(lead.location ?? "");
  const [notes, setNotes] = useState(lead.customer.notes ?? "");
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState(control);
  const [busy, setBusy] = useState(false);
  const [controlSaving, setControlSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [conversationError, setConversationError] = useState("");
  const attempt = useAttemptKey();
  const failureText = useFailureText();

  const saveLead = useGuarded(saveLeadHandler);
  async function saveLeadHandler() {
    setBusy(true);
    setError("");
    try {
      const res = await timedFetch(
        `/api/businesses/${organizationId}/leads/${lead.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status,
            priority,
            service,
            description,
            location,
            assignedToUserId: assigned || null,
            notes,
          }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || t("error"));
        return;
      }
      router.refresh();
    } catch (err) {
      setError(failureText(classifyFailure(err, { write: true, idempotent: true })));
    } finally {
      setBusy(false);
    }
  }

  const saveControl = useGuarded(saveControlHandler);
  async function saveControlHandler(next: ConversationControl) {
    const previous = mode;
    setMode(next);
    if (!lead.conversationId) return;
    setControlSaving(true);
    setConversationError("");
    try {
      const res = await timedFetch(
        `/api/businesses/${organizationId}/conversations/${lead.conversationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ control: next }),
        },
      );
      if (!res.ok) {
        setMode(previous);
        setConversationError(t("controlError"));
        return;
      }
      router.refresh();
    } catch (err) {
      const failure = classifyFailure(err, { write: true, idempotent: true });
      if (!failure.outcomeUnknown) setMode(previous);
      setConversationError(
        failure.outcomeUnknown ? failureText(failure) : t("controlError"),
      );
      if (failure.outcomeUnknown) router.refresh();
    } finally {
      setControlSaving(false);
    }
  }

  const send = useGuarded(sendHandler);
  async function sendHandler() {
    if (!draft.trim()) return;
    setSending(true);
    setConversationError("");
    try {
      const res = await timedFetch(
        `/api/businesses/${organizationId}/leads/${lead.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: draft,
            idempotencyKey: attempt.for(draft.trim()),
          }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setConversationError(data.error || t("error"));
        return;
      }
      attempt.done();
      setDraft("");
      router.refresh();
    } catch (err) {
      // No answer: the message may have been saved. The text stays in the box
      // and sending it again reuses the same key, so it is saved once.
      const failure = classifyFailure(err, { write: true, idempotent: true });
      setConversationError(failureText(failure));
      if (failure.outcomeUnknown) router.refresh();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="flex flex-col gap-4 rounded-md border border-navy/10 bg-white p-4">
        <h2 className="font-semibold text-navy">{t("customer")}</h2>
        <p className="text-sm text-navy/80">
          {lead.customer.displayName || lead.customer.phoneE164}
          <span className="mt-1 block font-mono text-xs">{lead.customer.phoneE164}</span>
        </p>
        <label className="flex flex-col gap-1 text-sm text-navy">
          {t("status")}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as LeadStatus)}
            className="rounded-md border border-navy/20 px-2 py-2"
          >
            {STATUSES.map((item) => (
              <option key={item} value={item}>
                {t(`statuses.${item}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-navy">
          {t("priority")}
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as LeadPriority)}
            className="rounded-md border border-navy/20 px-2 py-2"
          >
            {PRIORITIES.map((item) => (
              <option key={item} value={item}>
                {t(`priorities.${item}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-navy">
          {t("assigned")}
          <select
            value={assigned}
            onChange={(e) => setAssigned(e.target.value)}
            className="rounded-md border border-navy/20 px-2 py-2"
          >
            <option value="">{t("unassigned")}</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-navy">
          {t("service")}
          <input
            value={service}
            onChange={(e) => setService(e.target.value)}
            className="rounded-md border border-navy/20 px-2 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-navy">
          {t("location")}
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="rounded-md border border-navy/20 px-2 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-navy">
          {t("description")}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="rounded-md border border-navy/20 px-2 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-navy">
          {t("notes")}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="rounded-md border border-navy/20 px-2 py-2"
          />
        </label>
        <p className="text-xs text-navy/60">
          {t("source")}: {t(`sources.${lead.source}`)}
        </p>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button aria-busy={busy}
          type="button"
          disabled={busy}
          onClick={() => void saveLead()}
          className="self-start rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          <BusyLabel pending={busy} busyLabel={t("saving")}>{t("save")}</BusyLabel>
        </button>
        <h3 className="mt-2 font-semibold text-navy">{t("events")}</h3>
        <ul className="flex flex-col gap-2 text-sm text-navy/80">
          {events.map((event) => (
            <li key={event.id}>
              <time dateTime={event.at} className="text-xs text-navy/60">
                {eventTime(event.at)}
              </time>{" "}
              {event.kind}
              {event.detail ? ` · ${event.detail}` : ""}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-navy/10 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-navy">{t("conversation")}</h2>
          <label className="flex items-center gap-2 text-sm text-navy">
            {t("control")}
            <select
              value={mode}
              disabled={controlSaving}
              aria-busy={controlSaving || undefined}
              onChange={(e) => void saveControl(e.target.value as ConversationControl)}
              className="rounded-md border border-navy/20 px-2 py-1 disabled:opacity-50"
            >
              {CONTROLS.map((item) => (
                <option key={item} value={item}>
                  {t(`controls.${item}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ul className="flex max-h-96 flex-col gap-2 overflow-auto">
          {messages.length === 0 ? (
            <li className="text-sm text-navy/60">{t("noMessages")}</li>
          ) : (
            messages.map((message) => (
              <li
                key={message.id}
                className={`rounded-md px-3 py-2 text-sm ${
                  message.direction === "outbound"
                    ? "bg-navy/10 text-navy"
                    : "bg-navy/5 text-navy"
                }`}
              >
                {message.body ? (
                  <p>{message.body}</p>
                ) : (
                  <p className="italic text-navy/60">{t("bodyNotKept")}</p>
                )}
                <p className="mt-1 text-xs text-navy/50">
                  {message.direction === "outbound" ? t("outbound") : t("inbound")}
                  {" · "}
                  {t(`delivery.${message.deliveryStatus}`)}
                  {message.simulated ? ` · ${t("simulated")}` : ""}
                  {message.automated ? ` · ${t("automated")}` : ""}
                </p>
              </li>
            ))
          )}
        </ul>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder={t("replyPlaceholder")}
          className="rounded-md border border-navy/20 px-2 py-2 text-sm"
        />
        <p className="text-xs text-navy/60">{t("manualNote")}</p>
        {conversationError ? (
          <p role="alert" className="text-sm text-red-700">
            {conversationError}
          </p>
        ) : null}
        <button
          type="button"
          disabled={sending || controlSaving || mode === "closed"}
          aria-busy={sending || undefined}
          onClick={() => void send()}
          className="self-start rounded-md border border-navy/20 px-4 py-2 text-sm font-semibold text-navy disabled:opacity-50"
        >
          <BusyLabel pending={sending} busyLabel={tFeedback("sending")}>
            {t("send")}
          </BusyLabel>
        </button>
      </section>
    </div>
  );
}
