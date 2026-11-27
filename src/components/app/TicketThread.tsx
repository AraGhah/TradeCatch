"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useFailureText } from "@/components/ui/FeedbackMessage";
import { BusyLabel } from "@/components/ui/Spinner";
import { Link } from "@/i18n/navigation";
import { classifyFailure } from "@/lib/client/use-action";

import { useAttemptKey } from "@/lib/client/attempt-key";
import { useGuarded } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
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
  const tFeedback = useTranslations("feedback");
  const failureText = useFailureText();
  const locale = useLocale() === "fr" ? "fr-CA" : "en-CA";
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState(false);
  // Which request is running: only that button shows its busy words.
  const [acting, setActing] = useState<"refresh" | "reply" | null>(null);
  const busy = acting !== null;
  const inFlight = useRef(false);
  const attempt = useAttemptKey();

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
      timedFetch(`/api/businesses/${organizationId}/support/tickets/${ticketId}`, {
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
    setActing("refresh");
    setNote("");
    setNoteError(false);
    try {
      await load();
    } finally {
      inFlight.current = false;
      setActing(null);
    }
  }

  const reply = useGuarded(replyHandler);
  async function replyHandler(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || !body.trim()) return;
    inFlight.current = true;
    setActing("reply");
    setNote("");
    setNoteError(false);
    try {
      const response = await timedFetch(
        `/api/businesses/${organizationId}/support/tickets/${ticketId}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body: body.trim(),
            idempotencyKey: attempt.for(body.trim()),
          }),
        },
      );
      setNoteError(!response.ok);
      setNote(response.ok ? t("sent") : t("error"));
      if (response.ok) {
        attempt.done();
        setBody("");
        await load();
      }
    } catch (err) {
      // No answer: the reply may have been sent. The text stays in the box; re-read the thread so a
      // reply that did arrive shows up before it is sent again.
      const failure = classifyFailure(err, { write: true });
      setNoteError(true);
      setNote(failure.outcomeUnknown ? failureText(failure) : t("error"));
      if (failure.outcomeUnknown) void load();
    } finally {
      inFlight.current = false;
      setActing(null);
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
          aria-busy={acting === "refresh"}
            onClick={() => void refresh()}
        >
          <BusyLabel pending={acting === "refresh"} busyLabel={tFeedback("loading")}>
              {t("refresh")}
            </BusyLabel>
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
        <section className="rounded-xl border border-navy/10 bg-white p-5 shadow-[0_1px_2px_rgb(12_20_30/0.04)] sm:p-6 text-sm text-navy">
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
            aria-busy={acting === "reply"}
            className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            <BusyLabel pending={acting === "reply"} busyLabel={tFeedback("sending")}>
              {t("reply")}
            </BusyLabel>
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
