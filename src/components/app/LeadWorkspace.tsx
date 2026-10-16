"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type {
  ConversationControl,
  CrmMessage,
  LeadPriority,
  LeadStatus,
  LeadWithCustomer,
} from "@/product/crm/types";

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
}: {
  organizationId: string;
  lead: LeadWithCustomer;
  events: { id: string; kind: string; detail?: string; at: string }[];
  messages: CrmMessage[];
  control: ConversationControl;
  people: Person[];
}) {
  const t = useTranslations("app.crm");
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
  const [error, setError] = useState("");

  async function saveLead() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
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
    } finally {
      setBusy(false);
    }
  }

  async function saveControl(next: ConversationControl) {
    setMode(next);
    if (!lead.conversationId) return;
    await fetch(
      `/api/businesses/${organizationId}/conversations/${lead.conversationId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ control: next }),
      },
    );
    router.refresh();
  }

  async function send() {
    if (!draft.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/businesses/${organizationId}/leads/${lead.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: draft }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || t("error"));
        return;
      }
      setDraft("");
      router.refresh();
    } finally {
      setBusy(false);
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
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveLead()}
          className="self-start rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? t("saving") : t("save")}
        </button>
        <h3 className="mt-2 font-semibold text-navy">{t("events")}</h3>
        <ul className="flex flex-col gap-2 text-sm text-navy/80">
          {events.map((event) => (
            <li key={event.id}>
              <span className="font-mono text-xs text-navy/50">
                {event.at.slice(0, 16).replace("T", " ")}
              </span>{" "}
              {event.kind}
              {event.detail ? ` — ${event.detail}` : ""}
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
              onChange={(e) => void saveControl(e.target.value as ConversationControl)}
              className="rounded-md border border-navy/20 px-2 py-1"
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
                <p>{message.body}</p>
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
        <button
          type="button"
          disabled={busy || mode === "closed"}
          onClick={() => void send()}
          className="self-start rounded-md border border-navy/20 px-4 py-2 text-sm font-semibold text-navy disabled:opacity-50"
        >
          {t("send")}
        </button>
      </section>
    </div>
  );
}
