"use client";

import { useEffect, useState } from "react";

type SessionRow = { id: string; createdAt: string; userAgent?: string };

export function SecurityPanel({
  organizationId,
  isAdmin,
  locale = "en",
}: {
  organizationId: string;
  isAdmin: boolean;
  locale?: "en" | "fr";
}) {
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
        // Administrator verification is mandatory and set up on the admin console
        // itself, so there is a single place that issues and confirms the key.
        <a className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white" href={locale === "fr" ? "/fr/admin" : "/admin"}>
          {locale === "fr" ? "Vérification administrateur" : "Administrator verification"}
        </a>
      ) : null}
      {message ? <p className="text-sm text-navy">{message}</p> : null}
    </div>
  );
}
