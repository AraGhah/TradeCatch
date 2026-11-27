"use client";

import { useState } from "react";

import { useAttemptKey } from "@/lib/client/attempt-key";
import { useSingleFlight } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
import { BusyLabel, InlineStatus } from "@/components/ui/Spinner";
import { ActionButton } from "@/components/ui/ActionButton";

type Ticket = {
  id: string;
  organizationId: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  assignedTo?: string;
};
type Detail = {
  ticket: Ticket & { description: string };
  messages: {
    id: string;
    body: string;
    internal: boolean;
    authorRole: string;
  }[];
  relatedLogs: { id: string; service: string; errorCode: string }[];
};

export function AdminSupportDesk() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [sentReply, setSentReply] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const loadFlight = useSingleFlight();
  const openFlight = useSingleFlight();
  const writeFlight = useSingleFlight();
  const attempt = useAttemptKey();
  const busy = writeFlight.pending || loadFlight.pending || openFlight.pending;

  async function loadHandler() {
    setMessage("");
    const response = await timedFetch("/api/admin/support/tickets");
    const body = (await response.json()) as { tickets?: Ticket[] };
    setTickets(body.tickets ?? []);
  }

  async function openHandler(id: string) {
    setMessage("");
    setOpeningId(id);
    try {
      const response = await timedFetch(`/api/admin/support/tickets/${id}`);
      setDetail((await response.json()) as Detail);
    } finally {
      setOpeningId(null);
    }
  }

  async function updateHandler(status: string) {
    if (!detail) return;
    setActing(`status:${status}`);
    setMessage("");
    try {
      const response = await timedFetch(
        `/api/admin/support/tickets/${detail.ticket.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status, assignedTo: "founder" }),
        },
      );
      setMessage(response.ok ? "Updated." : "Could not update.");
      await openHandler(detail.ticket.id);
      await loadHandler();
    } catch {
      setMessage("Could not update. Check the connection and try again.");
    } finally {
      setActing(null);
    }
  }

  async function sendHandler(internal: boolean) {
    if (!detail) return;
    const body = internal ? note : reply;
    setActing(internal ? "note" : "reply");
    setSentReply(false);
    setSavedNote(false);
    setMessage("");
    try {
      const response = await timedFetch(
        `/api/admin/support/tickets/${detail.ticket.id}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body,
            internal,
            idempotencyKey: attempt.for(`${detail.ticket.id}:${internal}:${body}`),
          }),
        },
      );
      if (response.ok) {
        attempt.done();
        setMessage(internal ? "Note saved." : "Sent.");
        if (internal) setSavedNote(true);
        else setSentReply(true);
        setReply("");
        setNote("");
        await openHandler(detail.ticket.id);
      } else {
        setMessage("Could not send.");
      }
    } catch {
      setMessage("Could not send. Check the connection and try again.");
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ActionButton
        type="button"
        pending={loadFlight.pending}
        busyLabel="Refreshing…"
        className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white"
        onClick={() => void loadFlight.run(loadHandler)}
      >
        Refresh tickets
      </ActionButton>
      {loadFlight.pending ? <InlineStatus>Loading tickets…</InlineStatus> : null}
      <ul className="flex flex-col gap-2">
        {tickets.map((ticket) => {
          const opening = openingId === ticket.id;
          return (
            <li key={ticket.id}>
              <button
                type="button"
                disabled={busy}
                aria-busy={opening || undefined}
                className="w-full rounded-md border border-navy/10 bg-white px-3 py-2 text-left text-sm text-navy disabled:opacity-60"
                onClick={() => void openFlight.run(() => openHandler(ticket.id))}
              >
                <BusyLabel pending={opening} busyLabel="Opening…">
                  {ticket.subject} · {ticket.organizationId} · {ticket.priority}{" "}
                  · {ticket.status}
                </BusyLabel>
              </button>
            </li>
          );
        })}
      </ul>
      {detail ? (
        <section className="flex flex-col gap-3 rounded-md border border-navy/10 bg-white p-4">
          <h2 className="text-lg font-semibold text-navy">
            {detail.ticket.subject}
          </h2>
          <p className="text-sm text-navy">{detail.ticket.description}</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                "investigating",
                "waiting_for_customer",
                "in_progress",
                "resolved",
                "closed",
              ] as const
            ).map((status) => {
              const thisBusy = acting === `status:${status}`;
              return (
                <button
                  key={status}
                  type="button"
                  disabled={busy}
                  aria-busy={thisBusy || undefined}
                  className="rounded-md border border-navy/15 px-2 py-1 text-xs disabled:opacity-60"
                  onClick={() => void writeFlight.run(() => updateHandler(status))}
                >
                  <BusyLabel pending={thisBusy} busyLabel="Updating…">
                    {status}
                  </BusyLabel>
                </button>
              );
            })}
          </div>
          <ul className="flex flex-col gap-2 text-sm">
            {detail.messages.map((item) => (
              <li key={item.id} className="text-navy">
                {item.internal ? "Internal" : item.authorRole}: {item.body}
              </li>
            ))}
          </ul>
          <textarea
            className="min-h-20 rounded-md border border-navy/15 px-3 py-2 text-sm"
            value={reply}
            disabled={busy}
            onChange={(event) => {
              setReply(event.target.value);
              setSentReply(false);
            }}
            placeholder="Reply to the contractor"
          />
          <ActionButton
            type="button"
            pending={acting === "reply"}
            busyLabel="Sending…"
            success={sentReply}
            successLabel="Sent"
            disabled={busy && acting !== "reply"}
            className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white"
            onClick={() => void writeFlight.run(() => sendHandler(false))}
          >
            Send reply
          </ActionButton>
          <textarea
            className="min-h-20 rounded-md border border-navy/15 px-3 py-2 text-sm"
            value={note}
            disabled={busy}
            onChange={(event) => {
              setNote(event.target.value);
              setSavedNote(false);
            }}
            placeholder="Internal note"
          />
          <ActionButton
            type="button"
            pending={acting === "note"}
            busyLabel="Saving…"
            success={savedNote}
            successLabel="Saved"
            disabled={busy && acting !== "note"}
            className="w-fit rounded-md border border-navy/15 px-3 py-2 text-sm"
            onClick={() => void writeFlight.run(() => sendHandler(true))}
          >
            Save internal note
          </ActionButton>
          <p className="text-xs text-navy/60">
            Related logs:{" "}
            {detail.relatedLogs
              .map((row) => `${row.service}:${row.errorCode}`)
              .join(", ") || "none"}
          </p>
        </section>
      ) : null}
      {message ? (
        <p className="text-sm text-navy" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
