"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

type Message = {
  id: string;
  body: string;
  authorRole: string;
  internal?: boolean;
  createdAt?: string;
};
type Ticket = {
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  createdAt?: string;
};

export function TicketThread({
  organizationId,
  ticketId,
}: {
  organizationId: string;
  ticketId: string;
}) {
  const t = useTranslations("app.support");
  const locale = useLocale() === "fr" ? "fr-CA" : "en-CA";
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const when = (iso?: string) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(iso))
      : "";
  const label = (group: "categories" | "priorities" | "statuses", value: string) =>
    t.has(`${group}.${value}`) ? t(`${group}.${value}` as "categories.ai") : value;

  const load = useCallback(
    () =>
      fetch(`/api/businesses/${organizationId}/support/tickets/${ticketId}`, {
        cache: "no-store",
      })
        .then(async (response) => {
          if (response.status === 404) return null;
          if (!response.ok) throw new Error("Ticket unavailable");
          return (await response.json()) as {
            ticket?: Ticket;
            messages?: Message[];
          };
        })
        .then((payload) => {
          setMissing(payload === null);
          setLoadFailed(false);
          if (!payload) return;
          setTicket(payload.ticket ?? null);
          setMessages(
            (payload.messages ?? []).filter((message) => !message.internal),
          );
        })
        .catch(() => setLoadFailed(true))
        .finally(() => setLoaded(true)),
    [organizationId, ticketId],
  );

  // The ticket and its replies are there when the page opens.
  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNote("");
    setNoteError(false);
    try {
      await load();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function reply(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || !body.trim()) return;
    inFlight.current = true;
    setBusy(true);
    setNote("");
    setNoteError(false);
    try {
      const response = await fetch(
        `/api/businesses/${organizationId}/support/tickets/${ticketId}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: body.trim() }),
        },
      );
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
      inFlight.current = false;
      setBusy(false);
    }
  }

  const back = (
    <Link href="/app/support" className="w-fit text-sm font-semibold text-navy underline">
      {t("back")}
    </Link>
  );

  if (missing) {
    return (
      <div className="flex max-w-xl flex-col gap-4">
        {back}
        <p role="alert" className="text-sm text-navy">
          {t("notFound")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {back}
        <button
          type="button"
          disabled={busy}
          className="min-h-9 w-fit text-sm font-semibold text-navy underline disabled:opacity-50"
          onClick={() => void refresh()}
        >
          {t("refresh")}
        </button>
      </div>
      {!loaded ? (
        <p role="status" className="text-sm text-navy/70">
          {t("loading")}
        </p>
      ) : null}
      {loadFailed ? (
        <p role="alert" className="text-sm text-red-700">
          {t("loadError")}
        </p>
      ) : null}
      {ticket ? (
        <section className="rounded-md border border-navy/10 bg-white px-4 py-3 text-sm text-navy">
          <p className="m-0 text-navy/70">
            {t("status")}: {label("statuses", ticket.status)}
            {" · "}
            {label("categories", ticket.category)}
            {" · "}
            {t("priority")}: {label("priorities", ticket.priority)}
            {ticket.createdAt
              ? ` · ${t("opened", { date: when(ticket.createdAt) })}`
              : ""}
          </p>
          <p className="mt-3 whitespace-pre-wrap break-words">
            {ticket.description}
          </p>
        </section>
      ) : null}
      {loaded && ticket && messages.length === 0 ? (
        <p className="text-sm text-navy/70">{t("noMessages")}</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {messages.map((message) => (
          <li
            key={message.id}
            className="rounded-md border border-navy/10 bg-white px-3 py-2 text-sm text-navy"
          >
            <p className="m-0 text-xs text-navy/60">
              {t.has(`roles.${message.authorRole}`)
                ? t(`roles.${message.authorRole}` as "roles.admin")
                : message.authorRole}
              {message.createdAt ? ` · ${when(message.createdAt)}` : ""}
            </p>
            <p className="m-0 mt-1 whitespace-pre-wrap break-words">
              {message.body}
            </p>
          </li>
        ))}
      </ul>
      {ticket ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => void reply(event)}
        >
          <label className="text-sm text-navy">
            {t("replyLabel")}
            <textarea
              required
              maxLength={4000}
              className="mt-1 min-h-24 w-full rounded-md border border-navy/15 px-3 py-2 text-sm"
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {t("reply")}
          </button>
        </form>
      ) : null}
      {note ? (
        <p
          role={noteError ? "alert" : "status"}
          className={`text-sm ${noteError ? "text-red-700" : "text-navy"}`}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}
