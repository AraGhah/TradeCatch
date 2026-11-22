"use client";

import { useState } from "react";

import { BusyLabel } from "@/components/ui/Spinner";
import { useAttemptKey } from "@/lib/client/attempt-key";
import { useSingleFlight } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
type Ticket = { id: string; organizationId: string; subject: string; category: string; priority: string; status: string; assignedTo?: string };
type Detail = { ticket: Ticket & { description: string }; messages: { id: string; body: string; internal: boolean; authorRole: string }[]; relatedLogs: { id: string; service: string; errorCode: string }[] };

export function AdminSupportDesk() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  // One change at a time across the status buttons and both send buttons.
  const flight = useSingleFlight();
  const [acting, setActing] = useState<string | null>(null);
  const attempt = useAttemptKey();

  async function load() {
    const response = await timedFetch("/api/admin/support/tickets");
    const body = (await response.json()) as { tickets?: Ticket[] };
    setTickets(body.tickets ?? []);
  }

  async function open(id: string) {
    const response = await timedFetch(`/api/admin/support/tickets/${id}`);
    setDetail((await response.json()) as Detail);
  }

  function act(which: string, task: () => Promise<void>) {
    return flight.run(async () => {
      setActing(which);
      setMessage("");
      try {
        await task();
      } catch {
        setMessage("No answer from the server. Refresh the ticket before trying again.");
      } finally {
        setActing(null);
      }
    });
  }

  function update(status: string) {
    return act(`status:${status}`, async () => {
      if (!detail) return;
      const response = await timedFetch(`/api/admin/support/tickets/${detail.ticket.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, assignedTo: "founder" }),
      });
      setMessage(response.ok ? "Updated." : "Could not update.");
      await open(detail.ticket.id);
      await load();
    });
  }

  function send(internal: boolean) {
    return act(internal ? "note" : "reply", async () => {
      if (!detail) return;
      const body = internal ? note : reply;
      const response = await timedFetch(`/api/admin/support/tickets/${detail.ticket.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body,
          internal,
          idempotencyKey: attempt.for(`${detail.ticket.id}:${internal}:${body}`),
        }),
      });
      setMessage(response.ok ? "Sent." : "Could not send.");
      if (response.ok) {
        attempt.done();
        setReply("");
        setNote("");
        await open(detail.ticket.id);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <button type="button" className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => void load()}>Refresh tickets</button>
      <ul className="flex flex-col gap-2">
        {tickets.map((ticket) => (
          <li key={ticket.id}>
            <button type="button" className="w-full rounded-md border border-navy/10 bg-white px-3 py-2 text-left text-sm text-navy" onClick={() => void open(ticket.id)}>
              {ticket.subject} · {ticket.organizationId} · {ticket.priority} · {ticket.status}
            </button>
          </li>
        ))}
      </ul>
      {detail ? (
        <section className="flex flex-col gap-3 rounded-md border border-navy/10 bg-white p-4">
          <h2 className="text-lg font-semibold text-navy">{detail.ticket.subject}</h2>
          <p className="text-sm text-navy">{detail.ticket.description}</p>
          <div className="flex flex-wrap gap-2">
            {["investigating", "waiting_for_customer", "in_progress", "resolved", "closed"].map((status) => (
              <button key={status} type="button" className="rounded-md border border-navy/15 px-2 py-1 text-xs disabled:opacity-50" disabled={flight.pending} aria-busy={acting === `status:${status}`} onClick={() => void update(status)}>
                <BusyLabel pending={acting === `status:${status}`} busyLabel="Saving…">{status}</BusyLabel>
              </button>
            ))}
          </div>
          <ul className="flex flex-col gap-2 text-sm">
            {detail.messages.map((item) => (
              <li key={item.id} className="text-navy">{item.internal ? "Internal" : item.authorRole}: {item.body}</li>
            ))}
          </ul>
          <textarea className="min-h-20 rounded-md border border-navy/15 px-3 py-2 text-sm" value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply to the contractor" />
          <button type="button" className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white disabled:opacity-50" disabled={flight.pending} aria-busy={acting === "reply"} onClick={() => void send(false)}>
            <BusyLabel pending={acting === "reply"} busyLabel="Sending…">Send reply</BusyLabel>
          </button>
          <textarea className="min-h-20 rounded-md border border-navy/15 px-3 py-2 text-sm" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Internal note" />
          <button type="button" className="w-fit rounded-md border border-navy/15 px-3 py-2 text-sm disabled:opacity-50" disabled={flight.pending} aria-busy={acting === "note"} onClick={() => void send(true)}>
            <BusyLabel pending={acting === "note"} busyLabel="Saving…">Save internal note</BusyLabel>
          </button>
          <p className="text-xs text-navy/60">Related logs: {detail.relatedLogs.map((row) => `${row.service}:${row.errorCode}`).join(", ") || "none"}</p>
        </section>
      ) : null}
      {message ? <p role="status" className="text-sm text-navy">{message}</p> : null}
    </div>
  );
}
