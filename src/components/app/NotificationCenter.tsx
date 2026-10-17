"use client";

import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

type Row = {
  id: string;
  title: string;
  message: string;
  priority: "normal" | "high" | "critical";
  type: string;
  href?: string;
  createdAt: string;
  readAt?: string;
  acknowledgedAt?: string;
};

export function NotificationCenter({ organizationId }: { organizationId: string }) {
  const t = useTranslations("app.alerts");
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (query) params.set("q", query);
    const res = await fetch(`/api/businesses/${organizationId}/notifications?${params}`);
    const data = (await res.json()) as { notifications?: Row[] };
    setRows(data.notifications ?? []);
  }

  useEffect(() => {
    let stop = false;
    async function pull() {
      if (stop || document.visibilityState === "hidden") return;
      await load();
    }
    void pull();
    const timer = window.setInterval(() => void pull(), 20_000);
    function onVisible() {
      if (document.visibilityState === "visible") void pull();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [organizationId, status, priority, query]);

  async function act(id: string, action: "read" | "acknowledge") {
    const res = await fetch(`/api/businesses/${organizationId}/notifications/${id}/${action}`, { method: action === "read" ? "PATCH" : "POST" });
    setMessage(res.ok ? t("saved") : t("error"));
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-md border border-navy/15 px-2 py-1.5 text-sm">
          <option value="">{t("all")}</option>
          <option value="unread">{t("unread")}</option>
          <option value="read">{t("read")}</option>
          <option value="acknowledged">{t("acknowledged")}</option>
        </select>
        <select value={priority} onChange={(event) => setPriority(event.target.value)} className="rounded-md border border-navy/15 px-2 py-1.5 text-sm">
          <option value="">{t("all")}</option>
          <option value="normal">{t("normal")}</option>
          <option value="high">{t("high")}</option>
          <option value="critical">{t("critical")}</option>
        </select>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search")} className="rounded-md border border-navy/15 px-2 py-1.5 text-sm" />
        <button type="button" onClick={() => void load()} className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold">{t("refresh")}</button>
        <button
          type="button"
          onClick={() => void fetch(`/api/businesses/${organizationId}/notifications/read-all`, { method: "POST" }).then(() => load())}
          className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-semibold"
        >
          {t("markAll")}
        </button>
        <Link href="/app/settings/notifications" className="rounded-md px-3 py-1.5 text-sm font-semibold text-navy underline">{t("settings")}</Link>
        <Link href="/app/notifications/escalation" className="rounded-md px-3 py-1.5 text-sm font-semibold text-navy underline">{t("escalation")}</Link>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-navy/20 bg-white px-4 py-8 text-center text-navy/60">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-navy/10 overflow-hidden rounded-md border border-navy/10 bg-white">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
              <div>
                <p className="font-semibold text-navy">
                  <span className={row.priority === "critical" ? "text-red-700" : row.priority === "high" ? "text-amber-800" : ""}>{t(row.priority)}</span>
                  {" · "}
                  {row.title}
                </p>
                <p className="mt-1 text-sm text-navy/70">{row.message}</p>
                <p className="mt-1 text-xs text-navy/50">{new Date(row.createdAt).toLocaleString()} · {row.readAt ? t("read") : t("unread")}{row.acknowledgedAt ? ` · ${t("acknowledged")}` : ""}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {row.href ? <Link href={row.href as "/app/leads"} className="text-sm font-semibold text-navy underline">{t("open")}</Link> : null}
                <button type="button" onClick={() => void act(row.id, "read")} className="text-sm font-semibold text-navy">{t("markRead")}</button>
                <button type="button" onClick={() => void act(row.id, "acknowledge")} className="text-sm font-semibold text-navy">{t("acknowledge")}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {message ? <p className="text-sm text-navy">{message}</p> : null}
    </div>
  );
}
