"use client";

import { useEffect, useState } from "react";

type SessionRow = { id: string; createdAt: string; userAgent?: string };

export function SecurityPanel({ organizationId, isAdmin }: { organizationId: string; isAdmin: boolean }) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`/api/businesses/${organizationId}/security`)
      .then((response) => response.json())
      .then((body) => {
        const parsed = body as { sessions?: SessionRow[] };
        setSessions(parsed.sessions ?? []);
      });
  }, [organizationId]);

  async function revoke(sessionId: string) {
    const response = await fetch(`/api/businesses/${organizationId}/security/sessions/${sessionId}`, { method: "POST" });
    setMessage(response.ok ? "Session revoked." : "Could not revoke that session.");
    if (response.ok) setSessions((rows) => rows.filter((row) => row.id !== sessionId));
  }

  async function enroll() {
    const response = await fetch(`/api/businesses/${organizationId}/security/mfa`, { method: "POST" });
    const body = (await response.json()) as { otpauth?: string; error?: string };
    setMessage(body.otpauth ? "Administrator verification is ready. Confirm it with your authenticator code." : body.error || "MFA is not available.");
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm ring-1 ring-navy/10">
            <span>{session.createdAt}</span>
            <button type="button" className="text-navy underline" onClick={() => revoke(session.id)}>Revoke</button>
          </li>
        ))}
      </ul>
      {isAdmin ? (
        <button type="button" className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => enroll()}>
          Turn on administrator verification
        </button>
      ) : null}
      {message ? <p className="text-sm text-navy">{message}</p> : null}
    </div>
  );
}
