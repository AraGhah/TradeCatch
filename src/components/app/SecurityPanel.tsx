"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("app.security");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  function fetchSessions() {
    return fetch(`/api/businesses/${organizationId}/security`)
      .then((response) => {
        if (!response.ok) throw new Error("Security sessions unavailable");
        return response.json();
      })
      .then((body) => {
        const parsed = body as { sessions?: SessionRow[] };
        setSessions(parsed.sessions ?? []);
        setLoadError(false);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }

  function retry() {
    setLoading(true);
    setLoadError(false);
    void fetchSessions();
  }

  useEffect(() => {
    void fetchSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  async function revoke(sessionId: string) {
    if (revokingId) return;
    setRevokingId(sessionId);
    setMessage("");
    setMessageError(false);
    try {
      const response = await fetch(
        `/api/businesses/${organizationId}/security/sessions/${sessionId}`,
        { method: "POST" },
      );
      setMessageError(!response.ok);
      setMessage(response.ok ? t("revoked") : t("revokeError"));
      if (response.ok)
        setSessions((rows) => rows.filter((row) => row.id !== sessionId));
    } catch {
      setMessageError(true);
      setMessage(t("revokeError"));
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {loadError ? (
        <div role="alert" className="text-sm text-red-700">
          <p>{t("loadError")}</p>
          <button
            type="button"
            className="mt-1 font-semibold underline"
            onClick={retry}
          >
            {t("retry")}
          </button>
        </div>
      ) : loading ? (
        <p role="status" className="text-sm text-navy/70">
          {t("sessions")}…
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm ring-1 ring-navy/10"
            >
              <span>{session.createdAt}</span>
              <button
                type="button"
                disabled={revokingId === session.id}
                className="text-navy underline disabled:opacity-50"
                onClick={() => void revoke(session.id)}
              >
                {t("revoke")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {isAdmin ? (
        // Administrator verification is mandatory and set up on the admin console
        // itself, so there is a single place that issues and confirms the key.
        <a
          className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white"
          href={locale === "fr" ? "/fr/admin" : "/admin"}
        >
          {t("adminVerification")}
        </a>
      ) : null}
      {message ? (
        <p
          role={messageError ? "alert" : "status"}
          className="text-sm text-navy"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
