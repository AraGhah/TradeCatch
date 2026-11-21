"use client";

import { useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

import { BusyLabel } from "@/components/ui/Spinner";
import { timedFetch } from "@/lib/client/timed-fetch";
const ERRORS = new Set(["status", "confirm", "own-session", "role", "last-owner", "member", "missing", "session"]);

/**
 * Runs one request at a time. The ref closes the gap a `disabled` button leaves
 * open: two clicks in the same frame both see the old state, but only one can
 * take the ref. A thrown request (offline, aborted) is reported like any other
 * failure instead of leaving the form silent. `active` says which button's
 * request is running, so only that one shows "Saving…".
 */
function useSingleFlight() {
  const running = useRef(false);
  const [active, setActive] = useState<string | null>(null);
  async function run<T>(key: string, work: () => Promise<T>): Promise<T | undefined> {
    if (running.current) return undefined;
    running.current = true;
    setActive(key);
    try {
      return await work();
    } finally {
      running.current = false;
      setActive(null);
    }
  }
  return { pending: active !== null, active, run };
}

type Notice = { text: string; error: boolean };

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
  const [message, setMessage] = useState<Notice | null>(null);
  const flight = useSingleFlight();

  async function post(path: string, payload: unknown) {
    try {
      const res = await timedFetch(`/api/admin/businesses/${encodeURIComponent(organizationId)}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      // A 5xx means the server failed after taking the request: whether the
      // change was applied is not known, so it is not reported as "not applied".
      return { ok: res.ok, error: body?.error, unknown: res.status >= 500 };
    } catch {
      // No answer (offline, dropped, or no reply within the time limit): the
      // request may have been processed.
      return { ok: false, error: undefined, unknown: true };
    }
  }

  const outcome = (result: { ok: boolean; unknown: boolean }): Notice =>
    result.ok
      ? { text: t("saved"), error: false }
      : { text: result.unknown ? t("unconfirmed") : t("error"), error: true };

  async function saveStatus(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const result = await flight.run("status", () => post("status", { status: nextStatus, confirm }));
    if (!result) return;
    setMessage(outcome(result));
    if (!result.ok && result.error && ERRORS.has(result.error)) setConfirm("");
    if (result.ok) setConfirm("");
  }

  async function saveRole(userId: string, role: string, confirmed: boolean) {
    if (!confirmed) {
      setMessage({ text: t("error"), error: true });
      return;
    }
    setMessage(null);
    const result = await flight.run(`role:${userId}`, () => post("role", { userId, role, confirm: true }));
    if (result) setMessage(outcome(result));
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={(event) => void saveStatus(event)}
        aria-busy={flight.active === "status"}
        className="flex flex-col gap-3 rounded-md border border-navy/10 bg-white p-4"
      >
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
          aria-busy={flight.active === "status"}
          className="min-h-10 min-w-28 w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <BusyLabel pending={flight.active === "status"} busyLabel={t("saving")}>
            {t("save")}
          </BusyLabel>
        </button>
      </form>
      <div className="rounded-md border border-navy/10 bg-white p-4">
        <h2 className="font-semibold text-navy">{t("members")}</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {members.map((member) => (
            <MemberRole
              key={member.userId}
              member={member}
              onSave={saveRole}
              label={t("roleTitle")}
              save={t("save")}
              saving={t("saving")}
              busy={flight.pending}
              running={flight.active === `role:${member.userId}`}
            />
          ))}
        </ul>
      </div>
      {/* Success is announced politely, a failure assertively; both stay in the page so nothing jumps. */}
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-navy">
        {message && !message.error ? message.text : null}
      </p>
      {message?.error ? (
        <p role="alert" className="text-sm font-medium text-red-800">
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

function MemberRole({
  member,
  onSave,
  label,
  save,
  saving,
  busy,
  running,
}: {
  member: { userId: string; name: string; email: string; role: string };
  onSave: (userId: string, role: string, confirmed: boolean) => Promise<void>;
  label: string;
  save: string;
  saving: string;
  /** Some request is running: every control waits. */
  busy: boolean;
  /** This row's own request is the one running. */
  running: boolean;
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
        aria-busy={running}
        aria-label={`${save}: ${member.name || member.email}`}
        onClick={() => void onSave(member.userId, role, confirmed)}
        className="min-h-10 min-w-24 rounded-md border border-navy/20 px-2 py-1 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      >
        <BusyLabel pending={running} busyLabel={saving}>
          {save}
        </BusyLabel>
      </button>
    </li>
  );
}
