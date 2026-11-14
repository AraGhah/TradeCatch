"use client";

import { useCallback, useEffect, useState } from "react";

type Business = { id: string; name: string; phone: string | null; plan: string; status: string };
type RecoveryRequest = {
  id: string;
  status: "open" | "verified" | "completed" | "rejected";
  accountEmail: string;
  contactEmail: string;
  contactName: string;
  businessName: string;
  phone?: string;
  details: string;
  createdAt: string;
  verificationMethod?: string;
  verificationNotes?: string;
  verifiedAt?: string;
  resolvedAt?: string;
  resolutionNotes?: string;
  match: null | {
    userName: string;
    currentEmail: string;
    isAdministrator: boolean;
    businesses: Business[];
  };
};

const METHODS = [
  { value: "phone_callback_number_on_file", label: "Called back the phone number on file" },
  { value: "billing_details_match", label: "Billing details match (card last 4, invoice amounts)" },
  { value: "video_call_photo_id", label: "Video call with photo ID" },
  { value: "signed_contract_details", label: "Details from the signed contract" },
] as const;

const ERRORS: Record<string, string> = {
  wrong_status: "This request was already handled. Refresh the list.",
  no_matching_account: "No account uses that email. Nothing can be changed.",
  protected_account: "Administrator accounts (and your own) cannot be recovered here.",
  weak_evidence: "Describe how you verified the person (at least 20 characters).",
  email_taken: "The new email already belongs to another account.",
  invalid_email: "The contact email is not valid.",
  not_found: "Request not found.",
};

function RequestCard({ request, onDone }: { request: RecoveryRequest; onDone: (notice: string | null) => void }) {
  const [method, setMethod] = useState<string>(METHODS[0].value);
  const [notes, setNotes] = useState("");
  const [rejectNotes, setRejectNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function act(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/account-recovery/${request.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; linkSent?: boolean };
      if (res.ok) {
        setNotes("");
        setRejectNotes("");
        setConfirmed(false);
        onDone(
          data.linkSent === false
            ? "The email was changed, but the password link could not be emailed. Ask the customer to use “Forgot your password” with the new address."
            : null,
        );
      } else {
        setMessage(ERRORS[data.error ?? ""] ?? data.error ?? "Could not save.");
      }
    } catch {
      setMessage("Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const open = request.status === "open";
  const verified = request.status === "verified";

  return (
    <li className="rounded-lg border border-navy/10 bg-white p-4 text-sm text-navy">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">
          {request.businessName} · {request.contactName}
        </p>
        <span className="rounded-full bg-navy/5 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
          {request.status}
        </span>
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-navy/60">Email on account</dt>
        <dd className="break-all">{request.accountEmail}</dd>
        <dt className="text-navy/60">New contact email</dt>
        <dd className="break-all">{request.contactEmail}</dd>
        <dt className="text-navy/60">Phone given</dt>
        <dd>{request.phone ?? "none"}</dd>
        <dt className="text-navy/60">Received</dt>
        <dd>{new Date(request.createdAt).toLocaleString()}</dd>
        <dt className="text-navy/60">Their message</dt>
        <dd className="whitespace-pre-wrap">{request.details}</dd>
      </dl>

      <div className="mt-3 rounded-md bg-[var(--color-surface,#f7f5f1)] p-3">
        <p className="font-semibold">Our records</p>
        {request.match ? (
          <>
            <p>
              {request.match.userName} · {request.match.currentEmail}
              {request.match.isAdministrator ? " · administrator (cannot be recovered here)" : ""}
            </p>
            <ul className="mt-1 list-disc pl-5">
              {request.match.businesses.map((b) => (
                <li key={b.id}>
                  {b.name} · phone on file {b.phone ?? "none"} · {b.plan} · {b.status}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-navy/70">
              Verify against these records, never against details the requester just gave.
            </p>
          </>
        ) : (
          <p>No account uses this email. Reply to the requester; nothing can be changed.</p>
        )}
      </div>

      {request.verificationMethod ? (
        <p className="mt-2 text-navy/70">
          Verified {request.verifiedAt ? new Date(request.verifiedAt).toLocaleString() : ""} by{" "}
          {request.verificationMethod}: {request.verificationNotes}
        </p>
      ) : null}
      {request.resolutionNotes ? <p className="mt-1 text-navy/70">Notes: {request.resolutionNotes}</p> : null}

      {open && request.match && !request.match.isAdministrator ? (
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            How identity was verified
            <select className="rounded-md border border-navy/15 px-2 py-2" value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Evidence (what you checked, who you spoke to, when)
            <textarea className="rounded-md border border-navy/15 px-2 py-2" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I personally verified that the requester owns this account.
          </label>
          <button
            type="button"
            disabled={busy || !confirmed || notes.trim().length < 20}
            className="w-fit rounded-md bg-navy px-3 py-2 text-white disabled:opacity-50"
            onClick={() => void act({ action: "verify", method, notes, confirmed: true })}
          >
            Record identity verification
          </button>
        </div>
      ) : null}

      {verified ? (
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            Move this account to {request.contactEmail}, sign out every device and email a password link to the new address.
          </label>
          <button
            type="button"
            disabled={busy || !confirmed}
            className="w-fit rounded-md bg-orange px-3 py-2 font-semibold text-navy disabled:opacity-50"
            onClick={() => void act({ action: "complete", confirmed: true })}
          >
            Change account email
          </button>
        </div>
      ) : null}

      {open || verified ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-navy/10 pt-3">
          <label className="flex flex-col gap-1">
            Reason for closing without changes
            <input className="rounded-md border border-navy/15 px-2 py-2" value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} />
          </label>
          <button
            type="button"
            disabled={busy || rejectNotes.trim().length < 5}
            className="w-fit rounded-md border border-navy/20 px-3 py-2 disabled:opacity-50"
            onClick={() => void act({ action: "reject", notes: rejectNotes })}
          >
            Reject request
          </button>
        </div>
      ) : null}

      {message ? (
        <p className="mt-2 text-red-700" role="alert">
          {message}
        </p>
      ) : null}
    </li>
  );
}

export function AdminAccountRecovery() {
  const [requests, setRequests] = useState<RecoveryRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/account-recovery");
      const data = (await res.json().catch(() => ({}))) as { requests?: RecoveryRequest[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not load requests.");
        return;
      }
      setRequests(data.requests ?? []);
    } catch {
      setError("Could not load requests.");
    }
  }, []);

  useEffect(() => {
    // Load once on open; the list is refreshed after every action.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <button type="button" className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => void load()}>
        Refresh requests
      </button>
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-md border border-orange/40 bg-orange/10 px-3 py-2 text-sm text-navy" role="status">
          {notice}
        </p>
      ) : null}
      {requests && requests.length === 0 ? <p className="text-sm text-navy/70">No recovery requests.</p> : null}
      <ul className="flex flex-col gap-3">
        {(requests ?? []).map((request) => (
          <RequestCard
            key={request.id}
            request={request}
            onDone={(message) => {
              setNotice(message);
              void load();
            }}
          />
        ))}
      </ul>
    </div>
  );
}
