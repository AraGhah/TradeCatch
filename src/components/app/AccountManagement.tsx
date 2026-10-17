"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function AccountManagement({
  organizationId,
  initialName,
  billingPortalUrl,
}: {
  organizationId: string;
  initialName: string;
  billingPortalUrl?: string;
}) {
  const t = useTranslations("app.account");
  const [name, setName] = useState(initialName);
  const [message, setMessage] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/businesses/${organizationId}/account/profile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setMessage(response.ok ? t("saved") : t("error"));
  }

  async function request(path: string, body?: object) {
    const response = await fetch(path, {
      method: path.endsWith("/export") ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: path.endsWith("/export") ? undefined : JSON.stringify(body ?? {}),
    });
    const payload = await response.json();
    setMessage(response.ok ? JSON.stringify(payload) : t("error"));
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-sm text-navy/70">{t("password")}</p>
      <p className="text-sm text-navy/70">{t("phoneStays")}</p>
      <form className="flex flex-col gap-2" onSubmit={(event) => void save(event)}>
        <label className="text-sm text-navy">{t("name")}<input className="mt-1 w-full rounded-md border border-navy/15 px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white">{t("save")}</button>
      </form>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-md border border-navy/15 px-3 py-2 text-sm" onClick={() => void request(`/api/businesses/${organizationId}/account/lifecycle`, { kind: "suspension" })}>{t("suspend")}</button>
        <button type="button" className="rounded-md border border-navy/15 px-3 py-2 text-sm" onClick={() => void request(`/api/businesses/${organizationId}/account/lifecycle`, { kind: "reactivation" })}>{t("reactivate")}</button>
        <button type="button" className="rounded-md border border-navy/15 px-3 py-2 text-sm" onClick={() => void request(`/api/businesses/${organizationId}/account/export`)}>{t("export")}</button>
        <button type="button" className="rounded-md border border-navy/15 px-3 py-2 text-sm" onClick={() => void request(`/api/businesses/${organizationId}/account/deletion-request`)}>{t("deletion")}</button>
      </div>
      <p className="text-sm text-navy/70">{t("deletionNote")}</p>
      {billingPortalUrl ? <a className="text-sm font-semibold text-navy underline" href={billingPortalUrl}>{t("billing")}</a> : <p className="text-sm text-navy/70">{t("billingMissing")}</p>}
      <Link href="/app/settings/security" className="text-sm font-semibold text-navy underline">{t("sessions")}</Link>
      {message ? <p className="text-sm text-navy">{message}</p> : null}
    </div>
  );
}
