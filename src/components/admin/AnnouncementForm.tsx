"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

import { useAttemptKey } from "@/lib/client/attempt-key";
import { useSingleFlight } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
import { ActionButton } from "@/components/ui/ActionButton";

export function AnnouncementForm() {
  const t = useTranslations("admin.platform");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [resultError, setResultError] = useState(false);
  const [queued, setQueued] = useState(false);
  const flight = useSingleFlight();
  const attempt = useAttemptKey();

  async function submitHandler() {
    setResult(null);
    setResultError(false);
    setQueued(false);
    try {
      const res = await timedFetch("/api/admin/announcements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Never `done()`: the same words sent again, even after success, are the
        // same announcement and must not reach every business a second time.
        body: JSON.stringify({
          message,
          confirm,
          idempotencyKey: attempt.for(message.trim()),
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        queued?: number;
      } | null;
      if (res.ok) {
        setQueued(true);
        setResult(t("announceQueued", { count: body?.queued ?? 0 }));
      } else {
        setResultError(true);
        setResult(t("error"));
      }
    } catch {
      setResultError(true);
      setResult(t("error"));
    }
  }

  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void flight.run(submitHandler);
      }}
      className="flex flex-col gap-3 rounded-md border border-navy/10 bg-white p-4"
    >
      <h2 className="font-semibold text-navy">{t("announceTitle")}</h2>
      <p className="text-sm text-navy/70">{t("announceHint")}</p>
      <textarea
        value={message}
        onChange={(event) => {
          setMessage(event.target.value);
          setQueued(false);
        }}
        maxLength={500}
        rows={3}
        disabled={flight.pending}
        className="rounded-md border border-navy/15 px-2 py-1.5 text-sm"
      />
      <label className="text-sm text-navy/70">
        {t("announceConfirm")}
        <input
          value={confirm}
          onChange={(event) => {
            setConfirm(event.target.value);
            setQueued(false);
          }}
          disabled={flight.pending}
          className="mt-1 block rounded-md border border-navy/15 px-2 py-1.5"
        />
      </label>
      <ActionButton
        type="submit"
        pending={flight.pending}
        busyLabel={t("announceSending")}
        success={queued}
        successLabel={t("announceQueuedShort")}
        className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white"
      >
        {t("announceSend")}
      </ActionButton>
      {result ? (
        <p
          role={resultError ? "alert" : "status"}
          className={`text-sm ${resultError ? "text-red-800" : "text-navy"}`}
        >
          {result}
        </p>
      ) : null}
    </form>
  );
}
