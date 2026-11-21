"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useFailureText } from "@/components/ui/FeedbackMessage";
import { LoadingRegion, SkeletonRows } from "@/components/ui/Skeleton";
import { BusyLabel } from "@/components/ui/Spinner";
import { Link } from "@/i18n/navigation";
import { classifyFailure } from "@/lib/client/use-action";

import { useGuarded } from "@/lib/client/use-single-flight";
import { timedFetch } from "@/lib/client/timed-fetch";
type Ticket = {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
};

const CATEGORIES = ["ai", "calls", "sms", "appointments", "billing", "other"] as const;
const PRIORITIES = ["normal", "high", "critical"] as const;
const FIELD = "mt-1 w-full rounded-md border border-navy/15 px-3 py-2";

export function SupportHome({
  organizationId,
  contactEmail,
}: {
  organizationId: string;
  contactEmail: string;
}) {
  const t = useTranslations("app.support");
  const tFeedback = useTranslations("feedback");
  const failureText = useFailureText();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("ai");
  const [priority, setPriority] = useState<string>("normal");
  const [kind, setKind] = useState("issue");
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      timedFetch(`/api/businesses/${organizationId}/support/tickets`, {
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Tickets unavailable");
          return (await response.json()) as { tickets?: Ticket[] };
        })
        .then((body) => {
          setTickets(body.tickets ?? []);
          setLoadError(false);
        })
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false)),
    [organizationId],
  );

  // The list is there when the page opens; "Refresh" only re-reads it.
  useEffect(() => {
    void load();
  }, [load]);

  const submit = useGuarded(submitHandler);
  async function submitHandler(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    setMessageError(false);
    try {
      const response = await timedFetch(
        `/api/businesses/${organizationId}/support/tickets`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            subject: subject.trim(),
            description: description.trim(),
            category,
            priority,
            kind,
            contactEmail,
          }),
        },
      );
      setMessageError(!response.ok);
      setMessage(response.ok ? t("sent") : t("error"));
      if (response.ok) {
        setSubject("");
        setDescription("");
        await load();
      }
    } catch (err) {
      // No answer: the ticket may have been created. Keep what was typed, say so, and re-read the list
      // so a ticket that did arrive shows up before anyone sends it a second time.
      const failure = classifyFailure(err, { write: true });
      setMessageError(true);
      setMessage(failure.outcomeUnknown ? failureText(failure) : t("error"));
      if (failure.outcomeUnknown) void load();
    } finally {
      setBusy(false);
    }
  }

  const label = (group: "categories" | "priorities" | "statuses", value: string) =>
    t.has(`${group}.${value}`) ? t(`${group}.${value}` as "categories.ai") : value;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/app/help" className="font-semibold text-navy underline">
          {t("help")}
        </Link>
        <Link
          href="/app/support/diagnostics"
          className="font-semibold text-navy underline"
        >
          {t("diagnostics")}
        </Link>
      </div>
      <form
        className="flex max-w-xl flex-col gap-3"
        onSubmit={(event) => void submit(event)}
      >
        <label className="text-sm text-navy">
          {t("subject")}
          <input
            className={FIELD}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            required
            minLength={3}
            maxLength={140}
          />
        </label>
        <label className="text-sm text-navy">
          {t("category")}
          <select
            className={FIELD}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {t(`categories.${item}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-navy">
          {t("kind")}
          <select
            className={FIELD}
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="issue">{t("issue")}</option>
            <option value="bug">{t("bug")}</option>
            <option value="feature">{t("feature")}</option>
          </select>
        </label>
        <label className="text-sm text-navy">
          {t("priority")}
          <select
            className={FIELD}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            {PRIORITIES.map((item) => (
              <option key={item} value={item}>
                {t(`priorities.${item}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-navy">
          {t("description")}
          <textarea
            className={`${FIELD} min-h-28`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
            minLength={3}
            maxLength={4000}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          <BusyLabel pending={busy} busyLabel={tFeedback("sending")}>
            {t("submit")}
          </BusyLabel>
        </button>
        {message ? (
          <p
            role={messageError ? "alert" : "status"}
            className={`text-sm ${messageError ? "text-red-700" : "text-navy"}`}
          >
            {message}
          </p>
        ) : null}
      </form>
      <section aria-labelledby="support-tickets-title">
        <div className="flex items-center justify-between">
          <h2
            id="support-tickets-title"
            className="text-lg font-semibold text-navy"
          >
            {t("mine")}
          </h2>
          <button
            type="button"
            disabled={loading}
            aria-busy={loading}
            className="min-h-9 text-sm font-semibold text-navy underline disabled:opacity-50"
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            <BusyLabel pending={loading} busyLabel={tFeedback("loading")}>
              {t("refresh")}
            </BusyLabel>
          </button>
        </div>
        {loadError ? (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {t("loadError")}
          </p>
        ) : null}
        {tickets === null && !loadError ? (
          <LoadingRegion label={t("loading")} className="mt-2">
            <SkeletonRows rows={3} columns={2} />
          </LoadingRegion>
        ) : null}
        <ul className="mt-3 flex flex-col gap-2">
          {(tickets ?? []).map((ticket) => (
            <li key={ticket.id}>
              <Link
                href={{
                  pathname: "/app/support/[ticketId]",
                  params: { ticketId: ticket.id },
                }}
                className="block rounded-md border border-navy/10 bg-white px-3 py-2 text-sm text-navy"
              >
                <span className="font-semibold">{ticket.subject}</span>
                <span className="text-navy/70">
                  {" · "}
                  {label("categories", ticket.category)}
                  {" · "}
                  {label("priorities", ticket.priority)}
                  {" · "}
                  {label("statuses", ticket.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {tickets && tickets.length === 0 ? (
          <p className="mt-2 text-sm text-navy/70">{t("empty")}</p>
        ) : null}
      </section>
    </div>
  );
}
