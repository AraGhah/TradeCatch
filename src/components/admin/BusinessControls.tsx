"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

const ERRORS = new Set(["status", "confirm", "own-session", "role", "last-owner", "member", "missing", "session"]);

export function BusinessControls({
  organizationId,
  status,
  members,
}: {
  organizationId: string;
  status: string;
  members: { userId: string; name: string; email: string; role: string }[];
}) {
  const t = useTranslations("admin.platform");
  const [nextStatus, setNextStatus] = useState(status);
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function saveStatus(event: FormEvent) {
    event.preventDefault();
    const res = await fetch(`/api/admin/businesses/${organizationId}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: nextStatus, confirm }),
    });
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    setMessage(res.ok ? t("saved") : t("error"));
    if (!res.ok && body?.error && ERRORS.has(body.error)) setConfirm("");
  }

  async function saveRole(userId: string, role: string, confirmed: boolean) {
    if (!confirmed) {
      setMessage(t("error"));
      return;
    }
    const res = await fetch(`/api/admin/businesses/${organizationId}/role`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, role, confirm: true }),
    });
    setMessage(res.ok ? t("saved") : t("error"));
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={(event) => void saveStatus(event)} className="flex flex-col gap-3 rounded-md border border-navy/10 bg-white p-4">
        <h2 className="font-semibold text-navy">{t("statusTitle")}</h2>
        <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className="w-fit rounded-md border border-navy/15 px-2 py-1.5 text-sm">
          <option value="active">activate</option>
          <option value="suspended">suspend</option>
          <option value="churned">deactivate</option>
        </select>
        <label className="text-sm text-navy/70">
          {t("confirmLabel")}
          <input value={confirm} onChange={(event) => setConfirm(event.target.value)} className="mt-1 block rounded-md border border-navy/15 px-2 py-1.5" />
        </label>
        <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">{t("save")}</button>
      </form>
      <div className="rounded-md border border-navy/10 bg-white p-4">
        <h2 className="font-semibold text-navy">{t("members")}</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {members.map((member) => (
            <MemberRole key={member.userId} member={member} onSave={saveRole} label={t("roleTitle")} save={t("save")} />
          ))}
        </ul>
      </div>
      {message ? <p className="text-sm text-navy">{message}</p> : null}
    </div>
  );
}

function MemberRole({
  member,
  onSave,
  label,
  save,
}: {
  member: { userId: string; name: string; email: string; role: string };
  onSave: (userId: string, role: string, confirmed: boolean) => Promise<void>;
  label: string;
  save: string;
}) {
  const [role, setRole] = useState(member.role);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-40">
        <span className="block font-semibold text-navy">{member.name || member.email}</span>
        <span className="text-navy/60">{member.email}</span>
      </span>
      <label className="text-navy/70">
        {label}
        <select value={role} onChange={(event) => setRole(event.target.value)} className="ml-2 rounded-md border border-navy/15 px-2 py-1">
          <option value="owner">owner</option>
          <option value="admin">admin</option>
          <option value="member">member</option>
          <option value="viewer">viewer</option>
        </select>
      </label>
      <label className="flex items-center gap-1 text-navy/70">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        OK
      </label>
      <button type="button" onClick={() => void onSave(member.userId, role, confirmed)} className="rounded-md border border-navy/20 px-2 py-1 font-semibold">
        {save}
      </button>
    </li>
  );
}
