"use client";

import { useState } from "react";

type Ticket = { id: string; organizationId: string; subject: string; category: string; priority: string; status: string; assignedTo?: string };
type Detail = { ticket: Ticket & { description: string }; messages: { id: string; body: string; internal: boolean; authorRole: string }[]; relatedLogs: { id: string; service: string; errorCode: string }[] };

export function AdminSupportDesk() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const response = await fetch("/api/admin/support/tickets");
    const body = (await response.json()) as { tickets?: Ticket[] };
    setTickets(body.tickets ?? []);
  }

  async function open(id: string) {
    const response = await fetch(`/api/admin/support/tickets/${id}`);
    setDetail((await response.json()) as Detail);
  }

  async function update(status: string) {
    if (!detail) return;
    const response = await fetch(`/api/admin/support/tickets/${detail.ticket.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, assignedTo: "founder" }),
    });
    setMessage(response.ok ? "Updated." : "Could not update.");
    await open(detail.ticket.id);
    await load();
  }

  async function send(internal: boolean) {
    if (!detail) return;
    const response = await fetch(`/api/admin/support/tickets/${detail.ticket.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: internal ? note : reply, internal }),
    });
    setMessage(response.ok ? "Sent." : "Could not send.");
    if (response.ok) {
      setReply("");
      setNote("");
      await open(detail.ticket.id);
    }
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
              <button key={status} type="button" className="rounded-md border border-navy/15 px-2 py-1 text-xs" onClick={() => void update(status)}>{status}</button>
            ))}
          </div>
          <ul className="flex flex-col gap-2 text-sm">
            {detail.messages.map((item) => (
              <li key={item.id} className="text-navy">{item.internal ? "Internal" : item.authorRole}: {item.body}</li>
            ))}
          </ul>
          <textarea className="min-h-20 rounded-md border border-navy/15 px-3 py-2 text-sm" value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply to the contractor" />
          <button type="button" className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => void send(false)}>Send reply</button>
          <textarea className="min-h-20 rounded-md border border-navy/15 px-3 py-2 text-sm" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Internal note" />
          <button type="button" className="w-fit rounded-md border border-navy/15 px-3 py-2 text-sm" onClick={() => void send(true)}>Save internal note</button>
          <p className="text-xs text-navy/60">Related logs: {detail.relatedLogs.map((row) => `${row.service}:${row.errorCode}`).join(", ") || "none"}</p>
        </section>
      ) : null}
      {message ? <p className="text-sm text-navy">{message}</p> : null}
    </div>
  );
}
