"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type Message = { id: string; body: string; authorRole: string; internal?: boolean };

export function TicketThread({ organizationId, ticketId }: { organizationId: string; ticketId: string }) {
  const t = useTranslations("app.support");
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (busy) return;
    setBusy(true);
    setNote("");
    setNoteError(false);
    try {
      const response = await fetch(`/api/businesses/${organizationId}/support/tickets/${ticketId}`);
      if (!response.ok) throw new Error("Ticket unavailable");
      const payload = (await response.json()) as { ticket?: { status: string }; messages?: Message[] };
      setStatus(payload.ticket?.status ?? "");
      setMessages((payload.messages ?? []).filter((message) => !message.internal));
    } catch {
      setNoteError(true);
      setNote(t("error"));
    } finally {
      setBusy(false);
    }
  }

  async function reply(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !body.trim()) return;
    setBusy(true);
    setNote("");
    setNoteError(false);
    try {
      const response = await fetch(`/api/businesses/${organizationId}/support/tickets/${ticketId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      setNoteError(!response.ok);
      setNote(response.ok ? t("sent") : t("error"));
      if (response.ok) {
        setBody("");
        await load();
      }
    } catch {
      setNoteError(true);
      setNote(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <button
        type="button"
        disabled={busy}
        className="w-fit text-sm font-semibold text-navy underline disabled:opacity-50"
        onClick={() => void load()}
      >
        {t("refresh")}
      </button>
      <p className="text-sm text-navy">{t("status")}: {status}</p>
      <ul className="flex flex-col gap-2">
        {messages.map((message) => (
          <li key={message.id} className="rounded-md border border-navy/10 bg-white px-3 py-2 text-sm text-navy">{message.authorRole}: {message.body}</li>
        ))}
      </ul>
      <form className="flex flex-col gap-2" onSubmit={(event) => void reply(event)}>
        <textarea required className="min-h-24 rounded-md border border-navy/15 px-3 py-2 text-sm" value={body} onChange={(event) => setBody(event.target.value)} />
        <button type="submit" disabled={busy} className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white disabled:opacity-50">{t("reply")}</button>
        {note ? (
          <p role={noteError ? "alert" : "status"} className="text-sm text-navy">
            {note}
          </p>
        ) : null}
      </form>
    </div>
  );
}
