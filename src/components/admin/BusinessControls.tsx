"use client";

import { useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

const ERRORS = new Set(["status", "confirm", "own-session", "role", "last-owner", "member", "missing", "session"]);

/**
 * Runs one request at a time. The ref closes the gap a `disabled` button leaves
 * open: two clicks in the same frame both see the old state, but only one can
 * take the ref. A thrown request (offline, aborted) is reported like any other
 * failure instead of leaving the form silent.
 */
function useSingleFlight() {
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
    if (running.current) return undefined;
    running.current = true;
    setPending(true);
    try {
      return await work();
    } finally {
      running.current = false;
      setPending(false);
    }
  }
  return { pending, run };
}

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
  const flight = useSingleFlight();

  async function post(path: string, payload: unknown) {
    try {
      const res = await fetch(`/api/admin/businesses/${encodeURIComponent(organizationId)}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: res.ok, error: body?.error };
    } catch {
      return { ok: false, error: undefined };
    }
  }

  async function saveStatus(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const result = await flight.run(() => post("status", { status: nextStatus, confirm }));
    if (!result) return;
    setMessage(result.ok ? t("saved") : t("error"));
    if (!result.ok && result.error && ERRORS.has(result.error)) setConfirm("");
    if (result.ok) setConfirm("");
  }

  async function saveRole(userId: string, role: string, confirmed: boolean) {
    if (!confirmed) {
      setMessage(t("error"));
      return;
    }
    setMessage(null);
    const result = await flight.run(() => post("role", { userId, role, confirm: true }));
    if (result) setMessage(result.ok ? t("saved") : t("error"));
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={(event) => void saveStatus(event)} className="flex flex-col gap-3 rounded-md border border-navy/10 bg-white p-4">
        <h2 className="font-semibold text-navy">{t("statusTitle")}</h2>
        <select
          aria-label={t("statusTitle")}
          value={nextStatus}
          onChange={(event) => setNextStatus(event.target.value)}
          disabled={flight.pending}
          className="min-h-10 w-fit rounded-md border border-navy/15 px-2 py-1.5 text-sm"
        >
          <option value="active">activate</option>
          <option value="suspended">suspend</option>
          <option value="churned">deactivate</option>
        </select>
        <label className="text-sm text-navy/70">
          {t("confirmLabel")}
          <input
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            disabled={flight.pending}
            autoComplete="off"
            className="mt-1 block min-h-10 w-full max-w-xs rounded-md border border-navy/15 px-2 py-1.5"
          />
        </label>
        <button
          type="submit"
          disabled={flight.pending}
          className="min-h-10 w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("save")}
        </button>
      </form>
      <div className="rounded-md border border-navy/10 bg-white p-4">
        <h2 className="font-semibold text-navy">{t("members")}</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {members.map((member) => (
            <MemberRole key={member.userId} member={member} onSave={saveRole} label={t("roleTitle")} save={t("save")} busy={flight.pending} />
          ))}
        </ul>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-navy">
        {message}
      </p>
    </div>
  );
}

function MemberRole({
  member,
  onSave,
  label,
  save,
  busy,
}: {
  member: { userId: string; name: string; email: string; role: string };
  onSave: (userId: string, role: string, confirmed: boolean) => Promise<void>;
  label: string;
  save: string;
  busy: boolean;
}) {
  const [role, setRole] = useState(member.role);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-40">
        <span className="block font-semibold text-navy">{member.name || member.email}</span>
        <span className="break-all text-navy/60">{member.email}</span>
      </span>
      <label className="text-navy/70">
        {label}
        <select value={role} onChange={(event) => setRole(event.target.value)} disabled={busy} className="ml-2 min-h-10 rounded-md border border-navy/15 px-2 py-1">
          <option value="owner">owner</option>
          <option value="admin">admin</option>
          <option value="member">member</option>
          <option value="viewer">viewer</option>
        </select>
      </label>
      <label className="flex items-center gap-1 text-navy/70">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} />
        OK
      </label>
      <button
        type="button"
        disabled={busy}
        aria-label={`${save}: ${member.name || member.email}`}
        onClick={() => void onSave(member.userId, role, confirmed)}
        className="min-h-10 rounded-md border border-navy/20 px-2 py-1 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      >
        {save}
      </button>
    </li>
  );
}
