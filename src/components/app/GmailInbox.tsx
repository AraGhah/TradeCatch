"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { GMAIL_EVENT } from "@/components/app/GmailSyncBadge";
import type { GmailMessageSummary } from "@/product/gmail/types";

type Filter = "all" | "unread" | "customers" | "attachments";
const FILTERS: Filter[] = ["all", "unread", "customers", "attachments"];

type Page = { messages: GmailMessageSummary[]; next: string | null; unread: number };
type ErrorKey = "sync_failed" | "needs_reconnect" | "rate_limited" | "config_error" | "unauthorized";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 focus-visible:ring-offset-2";

function whenLabel(iso: string, locale: string): string {
  const at = new Date(iso);
  const sameDay = at.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(locale, sameDay ? { timeStyle: "short" } : { dateStyle: "medium" }).format(at);
}

function Paperclip() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.5a1.7 1.7 0 0 1-2.4-2.4L15 7" />
    </svg>
  );
}

export function GmailInbox({
  initial,
  connected,
  needsReconnect,
  lastError,
}: {
  initial: Page;
  connected: boolean;
  needsReconnect: boolean;
  lastError: string | null;
}) {
  const t = useTranslations("app.gmail");
  const locale = useLocale() === "fr" ? "fr-CA" : "en-CA";
  const [filter, setFilter] = useState<Filter>("all");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page>(initial);
  // Which (filter, query) the rows on screen belong to; differs from the
  // current choice while a request is in flight.
  const [loadedKey, setLoadedKey] = useState("all|");
  const [more, setMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Failures from the Refresh button; the connection's own state comes from props,
  // which the background sync keeps current through router.refresh().
  const [actionError, setActionError] = useState<ErrorKey | null>(null);
  const statusError: ErrorKey | null = needsReconnect
    ? "needs_reconnect"
    : lastError === "rate_limited" || lastError === "config_error" || lastError === "sync_failed"
      ? lastError
      : null;
  const error = actionError ?? statusError;
  const key = `${filter}|${query}`;
  const loading = loadedKey !== key;
  const latest = useRef(0);
  const current = useRef({ filter, query });
  useEffect(() => {
    current.current = { filter, query };
  }, [filter, query]);

  const load = useCallback(async (next: { filter: Filter; query: string; before?: string | null }) => {
    const ticket = ++latest.current;
    const params = new URLSearchParams({ filter: next.filter });
    if (next.query) params.set("q", next.query);
    if (next.before) params.set("before", next.before);
    try {
      const response = await fetch(`/api/app/gmail/messages?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as Page;
      if (ticket !== latest.current) return;
      setPage((previous) =>
        next.before ? { ...body, messages: [...previous.messages, ...body.messages] } : body,
      );
      setLoadedKey(`${next.filter}|${next.query}`);
    } catch {
      if (ticket !== latest.current) return;
      setLoadedKey(`${next.filter}|${next.query}`);
      setActionError("sync_failed");
    }
  }, []);

  // Debounce typing into the search box.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  // Re-query when the filter or search changes. The server-rendered page already
  // answers the initial "all, no search" case.
  useEffect(() => {
    if (key === "all|" && latest.current === 0) return;
    void load({ filter, query });
  }, [key, filter, query, load]);

  // A background sync found new mail: refresh the list in place.
  useEffect(() => {
    function onSync() {
      void load(current.current);
    }
    window.addEventListener(GMAIL_EVENT, onSync);
    return () => window.removeEventListener(GMAIL_EVENT, onSync);
  }, [load]);

  async function refresh() {
    setSyncing(true);
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/app/gmail/sync?mode=manual", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        added?: number;
        status?: { unread: number };
      };
      if (!response.ok || body.ok === false) {
        const known: ErrorKey[] = ["needs_reconnect", "rate_limited", "config_error", "unauthorized"];
        setActionError(known.includes(body.error as ErrorKey) ? (body.error as ErrorKey) : "sync_failed");
        return;
      }
      setNotice((body.added ?? 0) > 0 ? t("newEmails", { count: body.added ?? 0 }) : t("upToDate"));
      window.dispatchEvent(new CustomEvent(GMAIL_EVENT, { detail: body }));
    } catch {
      setActionError("sync_failed");
    } finally {
      setSyncing(false);
    }
  }

  async function loadMore() {
    setMore(true);
    await load({ filter, query, before: page.next });
    setMore(false);
  }

  const rows = page.messages;
  const empty = !loading && rows.length === 0;

  return (
    <div className="flex flex-col gap-4" data-testid="gmail-inbox">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <label htmlFor="gmail-search" className="text-sm font-semibold text-navy">
            {t("search")}
          </label>
          <input
            id="gmail-search"
            type="search"
            value={input}
            placeholder={t("searchPlaceholder")}
            onChange={(event) => setInput(event.target.value)}
            className={`mt-1 block w-full rounded-md border border-navy/25 bg-white px-3 py-2 text-sm text-navy ${FOCUS_RING}`}
          />
        </div>
        {connected ? (
          <button
            type="button"
            disabled={syncing}
            onClick={() => void refresh()}
            className={`rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${FOCUS_RING}`}
          >
            {syncing ? t("syncing") : t("sync")}
          </button>
        ) : null}
      </div>

      <div role="group" aria-label={t("filters.label")} className="flex flex-wrap gap-2">
        {FILTERS.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            className={`rounded-full border px-3 py-1 text-sm font-semibold ${FOCUS_RING} ${
              filter === id ? "border-navy bg-navy text-white" : "border-navy/25 text-navy hover:bg-navy/5"
            }`}
          >
            {t(`filters.${id}`)}
            {id === "unread" && page.unread > 0 ? ` (${page.unread})` : ""}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="min-h-5 text-sm">
        {notice ? <p className="text-navy/80">{notice}</p> : null}
        {error ? (
          <p role="alert" className="text-ember-text" data-testid="gmail-error">
            {t(`errors.${error}`)}{" "}
            {error === "needs_reconnect" ? (
              <a className="font-semibold underline" href={`/api/app/gmail/connect?locale=${locale.startsWith("fr") ? "fr" : "en"}`}>
                {t("reconnect")}
              </a>
            ) : null}
          </p>
        ) : null}
      </div>

      {!connected && rows.length === 0 && !needsReconnect ? (
        <div className="rounded-md border border-dashed border-navy/25 bg-white px-4 py-8 text-center">
          <p className="text-navy/80">{t("emptyNotConnected")}</p>
          <Link
            href="/app/settings"
            className={`mt-3 inline-block rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white ${FOCUS_RING}`}
          >
            {t("connect")}
          </Link>
        </div>
      ) : empty ? (
        <p className="rounded-md border border-dashed border-navy/25 bg-white px-4 py-8 text-center text-navy/80">
          {filter === "all" && !query ? t("empty") : t("emptyFiltered")}
        </p>
      ) : (
        <ul
          aria-label={t("listLabel")}
          aria-busy={loading}
          className={`divide-y divide-navy/10 overflow-hidden rounded-md border border-navy/10 bg-white ${loading ? "opacity-60" : ""}`}
        >
          {rows.map((item) => (
            <li key={item.id}>
              <Link
                href={{ pathname: "/app/mail/[id]", params: { id: item.id } }}
                className={`block px-4 py-3 hover:bg-navy/5 ${FOCUS_RING}`}
                data-unread={item.unread ? "true" : "false"}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className={`flex min-w-0 items-center gap-2 ${item.unread ? "font-extrabold" : "font-semibold"} text-navy`}>
                    {item.unread ? (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-orange" aria-hidden="true" />
                    ) : null}
                    <span className="truncate">{item.fromName || item.fromEmail}</span>
                    {item.unread ? <span className="sr-only">{t("unread")}</span> : null}
                    {item.important ? (
                      <span className="shrink-0 rounded bg-navy/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-navy">
                        {t("customerBadge")}
                      </span>
                    ) : null}
                    {item.hasAttachments ? (
                      <span className="text-navy/70">
                        <Paperclip />
                        <span className="sr-only">{t("attachment")}</span>
                      </span>
                    ) : null}
                  </p>
                  <time className="shrink-0 text-xs text-navy/70" dateTime={item.receivedAt} suppressHydrationWarning>
                    {whenLabel(item.receivedAt, locale)}
                  </time>
                </div>
                <p className={`mt-1 truncate text-sm text-navy ${item.unread ? "font-semibold" : ""}`}>
                  {item.subject || t("noSubject")}
                </p>
                <p className="mt-0.5 line-clamp-2 text-sm text-navy/70">{item.snippet}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {page.next && !loading ? (
        <button
          type="button"
          disabled={more}
          onClick={() => void loadMore()}
          className={`self-center rounded-md border border-navy/25 px-4 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-60 ${FOCUS_RING}`}
        >
          {more ? t("loading") : t("loadMore")}
        </button>
      ) : null}
    </div>
  );
}
