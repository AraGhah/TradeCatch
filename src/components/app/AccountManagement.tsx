"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

type MemberRole = "owner" | "admin" | "member" | "viewer";

const SETUP = [
  { href: "/app/settings/account", key: "setupProfile" },
  { href: "/app/bookings/availability", key: "setupHours" },
  { href: "/app/receptionist", key: "setupReceptionist" },
  { href: "/app/calls/settings", key: "setupPhone" },
  { href: "/app/settings/calendar", key: "setupCalendar" },
  { href: "/app/test-center", key: "setupTest" },
  { href: "/app/automations", key: "setupAutomations" },
] as const;

export function AccountManagement({
  organizationId,
  initialName,
  initialPhone,
  initialCity,
  initialServiceArea,
  initialIndustry,
  members,
  billingPortalUrl,
}: {
  organizationId: string;
  initialName: string;
  initialPhone: string;
  initialCity: string;
  initialServiceArea: string;
  initialIndustry: string;
  members: { name: string; email: string; role: MemberRole }[];
  billingPortalUrl?: string;
}) {
  const t = useTranslations("app.account");
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [city, setCity] = useState(initialCity);
  const [serviceArea, setServiceArea] = useState(initialServiceArea);
  const [industry, setIndustry] = useState(initialIndustry);
  const [message, setMessage] = useState("");

  const roleLabel: Record<MemberRole, string> = {
    owner: t("roleOwner"),
    admin: t("roleAdmin"),
    member: t("roleMember"),
    viewer: t("roleViewer"),
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/businesses/${organizationId}/account/profile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        phoneE164: phone.trim(),
        city,
        serviceArea,
        industry,
      }),
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

  const field =
    "mt-1 w-full rounded-md border border-navy/15 px-3 py-2 text-navy";

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <section className="rounded-md border border-navy/10 bg-white px-4 py-4">
        <h2 className="text-sm font-semibold text-navy">{t("setupTitle")}</h2>
        <p className="mt-1 text-sm text-navy/70">{t("setupIntro")}</p>
        <ol className="mt-3 flex list-decimal flex-col gap-1 pl-5 text-sm">
          {SETUP.map((step) => (
            <li key={step.href}>
              <Link href={step.href} className="font-semibold text-navy underline">
                {t(step.key)}
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <p className="text-sm text-navy/70">{t("password")}</p>
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <label className="text-sm text-navy">
          {t("name")}
          <input className={field} value={name} onChange={(event) => setName(event.target.value)} required minLength={2} />
        </label>
        <label className="text-sm text-navy">
          {t("phone")}
          <input className={field} value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" placeholder="+14385551234" />
          <span className="mt-1 block text-xs text-navy/55">{t("phoneHint")}</span>
        </label>
        <label className="text-sm text-navy">
          {t("city")}
          <input className={field} value={city} onChange={(event) => setCity(event.target.value)} />
        </label>
        <label className="text-sm text-navy">
          {t("serviceArea")}
          <input className={field} value={serviceArea} onChange={(event) => setServiceArea(event.target.value)} />
        </label>
        <label className="text-sm text-navy">
          {t("industry")}
          <input className={field} value={industry} onChange={(event) => setIndustry(event.target.value)} />
        </label>
        <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white">
          {t("save")}
        </button>
      </form>

      <section className="rounded-md border border-navy/10 bg-white px-4 py-3">
        <h2 className="text-sm font-semibold text-navy">{t("employees")}</h2>
        {members.length === 0 ? (
          <p className="mt-2 text-sm text-navy/70">{t("noTeam")}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2 text-sm text-navy/80">
            {members.map((member) => (
              <li key={`${member.email}-${member.role}`}>
                <span className="font-semibold text-navy">{member.name || member.email}</span>
                {member.email ? <span className="text-navy/60"> · {member.email}</span> : null}
                <span className="text-navy/60"> · {roleLabel[member.role]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm text-navy/70">{t("phoneStays")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-md border border-navy/15 px-3 py-2 text-sm" onClick={() => void request(`/api/businesses/${organizationId}/account/lifecycle`, { kind: "suspension" })}>{t("suspend")}</button>
        <button type="button" className="rounded-md border border-navy/15 px-3 py-2 text-sm" onClick={() => void request(`/api/businesses/${organizationId}/account/lifecycle`, { kind: "reactivation" })}>{t("reactivate")}</button>
        <button type="button" className="rounded-md border border-navy/15 px-3 py-2 text-sm" onClick={() => void request(`/api/businesses/${organizationId}/account/export`)}>{t("export")}</button>
        <button type="button" className="rounded-md border border-navy/15 px-3 py-2 text-sm" onClick={() => void request(`/api/businesses/${organizationId}/account/deletion-request`)}>{t("deletion")}</button>
      </div>
      <p className="text-sm text-navy/70">{t("deletionNote")}</p>
      {billingPortalUrl ? <a className="text-sm font-semibold text-navy underline" href={billingPortalUrl}>{t("billing")}</a> : <p className="text-sm text-navy/70">{t("billingMissing")}</p>}
      <Link href="/app/settings/security" className="text-sm font-semibold text-navy underline">{t("sessions")}</Link>
      <Link href="/app/settings/notifications" className="text-sm font-semibold text-navy underline">{t("alerts")}</Link>
      {message ? <p className="text-sm text-navy">{message}</p> : null}
    </div>
  );
}
