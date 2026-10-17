"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

type Ticket = { id: string; subject: string; category: string; priority: string; status: string };

export function SupportHome({ organizationId, contactEmail }: { organizationId: string; contactEmail: string }) {
  const t = useTranslations("app.support");
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("ai");
  const [priority, setPriority] = useState("normal");
  const [kind, setKind] = useState("issue");
  const [message, setMessage] = useState("");

  async function load() {
    const response = await fetch(`/api/businesses/${organizationId}/support/tickets`);
    const body = (await response.json()) as { tickets?: Ticket[] };
    setTickets(body.tickets ?? []);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/businesses/${organizationId}/support/tickets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject, description, category, priority, kind, contactEmail }),
    });
    setMessage(response.ok ? t("sent") : t("error"));
    if (response.ok) {
      setSubject("");
      setDescription("");
      await load();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/app/help" className="font-semibold text-navy underline">{t("help")}</Link>
        <Link href="/app/support/diagnostics" className="font-semibold text-navy underline">{t("diagnostics")}</Link>
      </div>
      <form className="flex max-w-xl flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <label className="text-sm text-navy">{t("subject")}<input className="mt-1 w-full rounded-md border border-navy/15 px-3 py-2" value={subject} onChange={(event) => setSubject(event.target.value)} required /></label>
        <label className="text-sm text-navy">{t("category")}
          <select className="mt-1 w-full rounded-md border border-navy/15 px-3 py-2" value={category} onChange={(event) => setCategory(event.target.value)}>
            {["ai", "calls", "sms", "appointments", "billing", "other"].map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-sm text-navy">{t("kind")}
          <select className="mt-1 w-full rounded-md border border-navy/15 px-3 py-2" value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="issue">{t("issue")}</option>
            <option value="bug">{t("bug")}</option>
            <option value="feature">{t("feature")}</option>
          </select>
        </label>
        <label className="text-sm text-navy">{t("priority")}
          <select className="mt-1 w-full rounded-md border border-navy/15 px-3 py-2" value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="normal">normal</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </select>
        </label>
        <label className="text-sm text-navy">{t("description")}<textarea className="mt-1 min-h-28 w-full rounded-md border border-navy/15 px-3 py-2" value={description} onChange={(event) => setDescription(event.target.value)} required /></label>
        <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white">{t("submit")}</button>
        {message ? <p className="text-sm text-navy">{message}</p> : null}
      </form>
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-navy">{t("mine")}</h2>
          <button type="button" className="text-sm font-semibold text-navy underline" onClick={() => void load()}>{t("refresh")}</button>
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {(tickets ?? []).map((ticket) => (
            <li key={ticket.id}>
              <Link href={{ pathname: "/app/support/[ticketId]", params: { ticketId: ticket.id } }} className="block rounded-md border border-navy/10 bg-white px-3 py-2 text-sm text-navy">
                {ticket.subject} · {ticket.category} · {ticket.priority} · {ticket.status}
              </Link>
            </li>
          ))}
        </ul>
        {tickets && tickets.length === 0 ? <p className="mt-2 text-sm text-navy/70">{t("empty")}</p> : null}
      </section>
    </div>
  );
}
