"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { GrowthUpsell } from "@/components/app/GrowthUpsell";
import { DashboardCharts } from "@/components/app/dashboard/DashboardCharts";
import {
  AppointmentsTable,
  CallsTable,
  LeadsTable,
  type CallFilter,
} from "@/components/app/dashboard/DashboardTables";
import {
  formatDuration,
  formatMoney,
  formatResponse,
  formatWhen,
} from "@/components/app/dashboard/format";
import type { DashboardOverview, Delta } from "@/product/saas/dashboard-overview";

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/70 focus-visible:ring-offset-2";

export function DashboardView({
  initial,
  pollQuery,
  customFrom,
  customTo,
  showGrowthUpsell,
  afterHeader,
}: {
  initial: DashboardOverview;
  pollQuery: string;
  customFrom?: string;
  customTo?: string;
  showGrowthUpsell: boolean;
  /** Rendered directly under the page header (used for the Gmail summary card). */
  afterHeader?: React.ReactNode;
}) {
  const t = useTranslations("app.home");
  const crm = useTranslations("app.crm");
  const locale = useLocale() === "fr" ? "fr" : "en";
  const [data, setData] = useState(initial);
  // Adopt fresh server data when the page re-renders (e.g. after router.refresh()),
  // adjusting state during render rather than in an effect.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setData(initial);
  }
  const [live, setLive] = useState<"ok" | "error">("ok");
  const [callFilter, setCallFilter] = useState<CallFilter>("all");
  const [leadStatus, setLeadStatus] = useState("all");
  const [appointmentStatus, setAppointmentStatus] = useState("all");
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    async function tick() {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch(`/api/app/overview?${pollQuery}`, { cache: "no-store" });
        if (!response.ok) throw new Error("overview");
        const body = (await response.json()) as { overview?: DashboardOverview };
        if (!stop && body.overview) {
          setData(body.overview);
          setLive("ok");
        }
      } catch {
        if (!stop) setLive("error");
      }
    }
    const timer = window.setInterval(() => void tick(), 20_000);
    function onVisible() {
      if (document.visibilityState === "visible") void tick();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollQuery]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedCallId(null);
        setSelectedAppointmentId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function reveal(id: string, next?: { calls?: CallFilter; leads?: string; appointments?: string }) {
    if (next?.calls) setCallFilter(next.calls);
    if (next?.leads) setLeadStatus(next.leads);
    if (next?.appointments) setAppointmentStatus(next.appointments);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const selectedAi = data.aiCalls.find((call) => call.id === selectedCallId);
  const selectedRow = data.callRows.find((call) => call.id === selectedCallId);
  const selectedAppointment = data.appointmentRows.find((row) => row.id === selectedAppointmentId);
  const quiet =
    (data.calls?.incoming.current ?? 0) === 0 &&
    (data.leads?.captured.current ?? 0) === 0 &&
    (data.recovery?.missedCallLeads.current ?? 0) === 0 &&
    (data.appointments?.booked.current ?? 0) === 0;

  const ranges = [
    { id: "today" as const, label: t("range.today") },
    { id: "7d" as const, label: t("range.7d") },
    { id: "30d" as const, label: t("range.30d") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[11px] tracking-[0.14em] text-ember-text uppercase">TradeCatch</p>
          <h1 className="mt-1 font-[family-name:var(--font-archivo)] text-3xl font-extrabold text-navy">
            {t("headline")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-navy/70">{t("intro")}</p>
          <p className="mt-2 text-xs text-navy/70" aria-live="polite">
            {live === "error" ? t("liveError") : t("live")} · {t("updated")} {formatWhen(data.generatedAt, locale)}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {ranges.map((range) => {
              const active = data.range.preset === range.id;
              const className = `rounded-full px-3 py-1.5 text-sm font-semibold ${FOCUS} ${
                active ? "bg-navy text-white" : "border border-navy/15 bg-white text-navy hover:bg-navy/5"
              }`;
              if (range.id === "7d") {
                return (
                  <Link key={range.id} href="/app" aria-current={active ? "page" : undefined} className={className}>
                    {range.label}
                  </Link>
                );
              }
              return (
                <Link
                  key={range.id}
                  href={{ pathname: "/app", query: { range: range.id } }}
                  aria-current={active ? "page" : undefined}
                  className={className}
                >
                  {range.label}
                </Link>
              );
            })}
          </div>
          <form className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="range" value="custom" />
            <label className="flex flex-col gap-1 text-xs font-semibold text-navy/70">
              {t("range.from")}
              <input
                type="date"
                name="from"
                required
                defaultValue={customFrom}
                className="rounded-md border border-navy/15 bg-white px-2 py-1.5 text-sm text-navy"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-navy/70">
              {t("range.to")}
              <input
                type="date"
                name="to"
                required
                defaultValue={customTo}
                className="rounded-md border border-navy/15 bg-white px-2 py-1.5 text-sm text-navy"
              />
            </label>
            <button
              type="submit"
              className={`rounded-md bg-orange px-3 py-2 text-sm font-semibold text-navy ${FOCUS}`}
            >
              {t("range.apply")}
            </button>
          </form>
        </div>
      </header>

      {afterHeader}

      {data.sources.calls === "unlinked" || data.sources.recovery === "unlinked" ? (
        <p className="rounded-xl border border-orange/30 bg-orange/10 px-4 py-3 text-sm text-navy">
          {t("notLinked")}
        </p>
      ) : null}
      {(["calls", "leads", "recovery", "appointments", "notices", "revenue", "pipeline", "reviews"] as const)
        .filter((key) => data.sources[key] === "error")
        .map((key) => (
          <p key={key} role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {t(`errors.${key}`)}
          </p>
        ))}
      {data.truncated.calls ? (
        <p className="rounded-xl border border-navy/10 bg-white px-4 py-3 text-sm text-navy/80">{t("truncatedCalls")}</p>
      ) : null}
      {data.truncated.leads ? (
        <p className="rounded-xl border border-navy/10 bg-white px-4 py-3 text-sm text-navy/80">{t("truncatedLeads")}</p>
      ) : null}
      {quiet ? (
        <p className="rounded-xl border border-dashed border-navy/20 bg-white px-4 py-6 text-sm text-navy/70">
          <span className="font-semibold text-navy">{t("emptyTitle")}</span> {t("emptyBody")}
        </p>
      ) : null}

      {data.notices.some((notice) => notice.unread) ? (
        <section id="alerts" className="rounded-xl border border-navy/10 bg-white p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-[family-name:var(--font-archivo)] text-base font-extrabold text-navy">
              {t("sectionAlerts")}
            </h2>
            <Link href="/app/notifications" className="text-sm font-semibold text-ember-text hover:underline">
              {t("viewAll")}
            </Link>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {data.notices
              .filter((notice) => notice.unread)
              .map((notice) => (
                <li key={notice.id}>
                  <AppPathLink
                    href={notice.href || "/app/notifications"}
                    className="flex flex-col rounded-lg border border-navy/10 px-3 py-2 hover:bg-paper sm:flex-row sm:items-baseline sm:justify-between"
                  >
                    <span className="font-semibold text-navy">
                      {notice.priority === "critical" ? "● " : null}
                      {notice.title}
                    </span>
                    <span className="text-xs text-navy/70">{formatWhen(notice.createdAt, locale)}</span>
                    <span className="text-sm text-navy/70 sm:basis-full">{notice.message}</span>
                  </AppPathLink>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {callCards(data, t).map((card) => (
          <StatCard key={card.label} card={card} onOpen={() => card.onOpen(reveal)} />
        ))}
        {data.calls ? (
          <StatCard
            card={{
              label: t("cards.duration"),
              value: formatDuration(data.calls.avgDurationSeconds.current, locale),
              hint:
                data.calls.avgDurationSeconds.samples > 0
                  ? t("samples", { count: data.calls.avgDurationSeconds.samples })
                  : t("noSamples"),
              delta: data.calls.avgDurationSeconds.samples > 0 ? {
                current: data.calls.avgDurationSeconds.current ?? 0,
                previous: data.calls.avgDurationSeconds.previous ?? 0,
                changePct: data.calls.avgDurationSeconds.changePct,
              } : null,
              tone: "neutral",
              onOpen: () => reveal("calls"),
            }}
            onOpen={() => reveal("calls")}
          />
        ) : null}
        {leadCards(data, t).map((card) => (
          <StatCard key={card.label} card={card} onOpen={() => card.onOpen(reveal)} />
        ))}
        {data.recovery ? (
          <StatCard
            card={{
              label: t("cards.response"),
              value: formatResponse(data.recovery.avgResponseMs.current, locale),
              hint:
                data.recovery.avgResponseMs.samples > 0
                  ? t("responseNote", { count: data.recovery.avgResponseMs.samples })
                  : t("noSamples"),
              delta: null,
              tone: "neutral",
              onOpen: () => reveal("leads"),
            }}
            onOpen={() => reveal("leads")}
          />
        ) : null}
        {appointmentCards(data, t).map((card) => (
          <StatCard key={card.label} card={card} onOpen={() => card.onOpen(reveal)} />
        ))}
        {moneyCards(data, t, locale).map((card) => (
          <StatCard key={card.label} card={card} onOpen={() => card.onOpen(reveal)} />
        ))}
      </div>

      <DashboardCharts points={data.series} outcomes={data.outcomes} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section id="activity" className="rounded-xl border border-navy/10 bg-white p-4 shadow-[var(--shadow-card)]">
          <h2 className="font-[family-name:var(--font-archivo)] text-base font-extrabold text-navy">
            {t("sectionActivity")}
          </h2>
          {data.activity.length === 0 ? (
            <p className="mt-4 text-sm text-navy/70">{t("activityEmpty")}</p>
          ) : (
            <ul className="mt-3 flex flex-col" aria-live="polite">
              {data.activity.map((item) => (
                <li key={item.id} className="border-t border-navy/10 py-3 first:border-t-0">
                  {item.href ? (
                    <AppPathLink href={item.href} className="group block">
                      <ActivityBody item={item} locale={locale} label={activityDetail(item, t, crm)} kind={t(`kind.${item.kind}`)} />
                    </AppPathLink>
                  ) : (
                    <ActivityBody item={item} locale={locale} label={activityDetail(item, t, crm)} kind={t(`kind.${item.kind}`)} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="ai" className="rounded-xl border border-navy/10 bg-white p-4 shadow-[var(--shadow-card)]">
          <h2 className="font-[family-name:var(--font-archivo)] text-base font-extrabold text-navy">
            {t("sectionAi")}
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <AiStat label={t("ai.handled")} value={data.calls?.aiHandled.current} />
            <AiStat label={t("ai.appointments")} value={data.appointments?.aiBooked.current} />
            <AiStat label={t("ai.transfers")} value={data.calls?.transferred.current} />
            <AiStat label={t("ai.followUp")} value={data.calls?.followUp.current} />
          </dl>
          {data.aiCalls.length === 0 ? (
            <p className="mt-4 text-sm text-navy/70">{t("activityEmpty")}</p>
          ) : (
            <ul className="mt-3 flex max-h-[28rem] flex-col gap-2 overflow-auto">
              {data.aiCalls.slice(0, 12).map((call) => (
                <li key={call.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAppointmentId(null);
                      setSelectedCallId(call.id);
                    }}
                    className={`w-full rounded-lg border px-3 py-2 text-left ${FOCUS} ${
                      selectedCallId === call.id ? "border-orange bg-orange/5" : "border-navy/10 hover:bg-paper"
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-navy">{call.caller}</span>
                      <span className="text-xs text-navy/70">{formatWhen(call.at, locale)}</span>
                    </span>
                    <span className="mt-1 block text-sm text-navy/70">
                      {call.outcome ? t(`outcomes.${call.outcome}`) : t("classification.open")}
                      {call.followUp ? ` · ${t("followUpBadge")}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {selectedCallId && (selectedAi || selectedRow) ? (
        <section className="rounded-xl border border-navy/10 bg-white p-4 shadow-[var(--shadow-card)]" aria-labelledby="call-detail-title">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wide text-navy/70 uppercase">{t("detailCall")}</p>
              <h2 id="call-detail-title" className="font-[family-name:var(--font-archivo)] text-xl font-extrabold text-navy">
                {selectedAi?.caller || selectedRow?.caller}
              </h2>
              <p className="text-sm text-navy/70">
                {selectedAi?.phone || selectedRow?.phone} · {formatWhen((selectedAi || selectedRow)!.at, locale)}
              </p>
            </div>
            <button type="button" className={`rounded-md px-2 py-1 text-sm text-navy/70 ${FOCUS}`} onClick={() => setSelectedCallId(null)}>
              {t("close")}
            </button>
          </div>
          {selectedAi?.summary || selectedRow?.summary ? (
            <p className="mt-3 text-sm text-navy">{selectedAi?.summary || selectedRow?.summary}</p>
          ) : (
            <p className="mt-3 text-sm text-navy/70">{t("noSummary")}</p>
          )}
          {selectedAi?.nextStep ? (
            <p className="mt-2 text-sm text-navy/80">
              <span className="font-semibold">{t("nextStep")}: </span>
              {selectedAi.nextStep}
            </p>
          ) : null}
          {selectedAi?.recordingUrl ? (
            <a
              href={selectedAi.recordingUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex text-sm font-semibold text-ember-text hover:underline"
            >
              {t("recording")}
            </a>
          ) : (
            <p className="mt-3 text-xs text-navy/70">{t("noRecording")}</p>
          )}
          {selectedAi?.transcriptPurged ? <p className="mt-2 text-xs text-navy/70">{t("transcriptPurged")}</p> : null}
          {selectedAi && selectedAi.turns.length > 0 ? (
            <ol className="mt-4 flex flex-col gap-2">
              {selectedAi.turns.map((turn, index) => (
                <li
                  key={`${turn.speaker}-${index}`}
                  className={`max-w-[40rem] rounded-lg px-3 py-2 text-sm ${
                    turn.speaker === "caller" ? "bg-paper text-navy" : "bg-navy text-white"
                  }`}
                >
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide opacity-70">
                    {turn.speaker === "caller" ? t("caller") : t("agent")}
                  </span>
                  {turn.text}
                </li>
              ))}
            </ol>
          ) : null}
          <Link href="/app/calls" className="mt-4 inline-flex text-sm font-semibold text-navy underline">
            {t("linkedCalls")}
          </Link>
        </section>
      ) : null}

      {selectedAppointment ? (
        <section className="rounded-xl border border-navy/10 bg-white p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wide text-navy/70 uppercase">{t("detailAppointment")}</p>
              <h2 className="font-[family-name:var(--font-archivo)] text-xl font-extrabold text-navy">
                {selectedAppointment.customerName || selectedAppointment.serviceName}
              </h2>
            </div>
            <button type="button" className={`rounded-md px-2 py-1 text-sm text-navy/70 ${FOCUS}`} onClick={() => setSelectedAppointmentId(null)}>
              {t("close")}
            </button>
          </div>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-navy/70">{t("cols.service")}</dt>
              <dd className="font-semibold text-navy">{selectedAppointment.serviceName}</dd>
            </div>
            <div>
              <dt className="text-navy/70">{t("cols.start")}</dt>
              <dd className="font-semibold text-navy">{formatWhen(selectedAppointment.startAt, locale)}</dd>
            </div>
            <div>
              <dt className="text-navy/70">{t("cols.status")}</dt>
              <dd className="font-semibold text-navy">{t(`appointmentStatus.${selectedAppointment.status}`)}</dd>
            </div>
            <div>
              <dt className="text-navy/70">{t("cols.source")}</dt>
              <dd className="font-semibold text-navy">{bookingSourceLabel(t, selectedAppointment.bookingSource)}</dd>
            </div>
          </dl>
          {selectedAppointment.serviceAddress ? (
            <p className="mt-3 text-sm text-navy/80">{selectedAppointment.serviceAddress}</p>
          ) : null}
          <Link href="/app/bookings" className="mt-4 inline-flex text-sm font-semibold text-navy underline">
            {t("linkedBookings")}
          </Link>
        </section>
      ) : null}

      <CallsTable
        rows={data.callRows}
        filter={callFilter}
        onFilter={setCallFilter}
        onOpen={(id) => {
          setSelectedAppointmentId(null);
          setSelectedCallId(id);
        }}
      />
      <LeadsTable rows={data.leadRows} status={leadStatus} onStatus={setLeadStatus} />
      <AppointmentsTable
        rows={data.appointmentRows}
        status={appointmentStatus}
        onStatus={setAppointmentStatus}
        onOpen={(id) => {
          setSelectedCallId(null);
          setSelectedAppointmentId(id);
        }}
      />

      {data.sources.revenue === "ready" ? (
        // A file download served by a route handler, not a page: <Link> would try to client-route it.
        // eslint-disable-next-line @next/next/no-html-link-for-pages
        <a
          href="/api/app/analytics?format=csv"
          className="self-start text-sm font-semibold text-navy underline-offset-2 hover:underline"
        >
          {t("exportCsv")}
        </a>
      ) : null}

      {showGrowthUpsell ? <GrowthUpsell /> : null}
    </div>
  );
}

function AppPathLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const lead = /^\/app\/leads\/([^/?#]+)/.exec(href);
  if (lead?.[1]) {
    return (
      <Link href={{ pathname: "/app/leads/[id]", params: { id: decodeURIComponent(lead[1]) } }} className={className}>
        {children}
      </Link>
    );
  }
  if (href.startsWith("/app/calls")) {
    return <Link href="/app/calls" className={className}>{children}</Link>;
  }
  if (href.startsWith("/app/bookings")) {
    return <Link href="/app/bookings" className={className}>{children}</Link>;
  }
  if (href.startsWith("/app/conversations")) {
    return <Link href="/app/conversations" className={className}>{children}</Link>;
  }
  if (href.startsWith("/app/leads")) {
    return <Link href="/app/leads" className={className}>{children}</Link>;
  }
  return <Link href="/app/notifications" className={className}>{children}</Link>;
}

function ActivityBody({
  item,
  locale,
  label,
  kind,
}: {
  item: DashboardOverview["activity"][number];
  locale: "en" | "fr";
  label: string;
  kind: string;
}) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-navy group-hover:underline">{item.title}</span>
        <span className="text-xs text-navy/70">{formatWhen(item.at, locale)}</span>
      </span>
      <span className="text-sm text-navy/65">
        {kind} · {label}
      </span>
    </span>
  );
}

function AiStat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg bg-paper px-3 py-2">
      <dt className="text-xs text-navy/70">{label}</dt>
      <dd className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{value ?? "—"}</dd>
    </div>
  );
}

type Reveal = (id: string, next?: { calls?: CallFilter; leads?: string; appointments?: string }) => void;

type CardModel = {
  label: string;
  value: string;
  hint?: string;
  delta: Delta | null;
  tone: "good" | "bad" | "neutral";
  onOpen: (reveal: Reveal) => void;
};

function StatCard({ card, onOpen }: { card: CardModel; onOpen: () => void }) {
  const t = useTranslations("app.home");
  const change = card.delta?.changePct;
  const improved = card.tone === "bad" ? (change ?? 0) < 0 : (change ?? 0) > 0;
  const worsened = card.tone === "bad" ? (change ?? 0) > 0 : (change ?? 0) < 0;
  const changeClass = change == null || change === 0 || card.tone === "neutral"
    ? "text-navy/70"
    : improved
      ? "text-signal-text"
      : worsened
        ? "text-ember-text"
        : "text-navy/70";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`rounded-xl border border-navy/10 bg-white px-4 py-4 text-left shadow-[var(--shadow-card)] motion-safe:transition motion-safe:hover:-translate-y-0.5 ${FOCUS}`}
    >
      <span className="block text-xs font-semibold tracking-wide text-navy/70 uppercase">{card.label}</span>
      <span className="mt-2 block font-[family-name:var(--font-archivo)] text-3xl font-extrabold text-navy">
        {card.value}
      </span>
      <span className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-navy/70">{card.hint || t("vsPrevious")}</span>
        {card.delta ? (
          <span className={`text-xs font-semibold ${changeClass}`}>
            {change == null ? t("newPeriod") : `${change > 0 ? "+" : ""}${change}%`}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function countCard(
  label: string,
  delta: Delta | null | undefined,
  tone: CardModel["tone"],
  onOpen: CardModel["onOpen"],
  unavailable: string,
): CardModel {
  if (!delta) {
    return { label, value: "—", hint: unavailable, delta: null, tone, onOpen };
  }
  return { label, value: String(delta.current), delta, tone, onOpen };
}

function callCards(
  data: DashboardOverview,
  t: (key: string) => string,
): CardModel[] {
  const unavailable = data.sources.calls === "unlinked" ? t("notLinkedShort") : t("unavailable");
  const block = data.calls;
  return [
    countCard(t("cards.incoming"), block?.incoming, "neutral", (reveal) => reveal("calls", { calls: "all" }), unavailable),
    countCard(t("cards.answered"), block?.answered, "good", (reveal) => reveal("calls", { calls: "answered" }), unavailable),
    countCard(t("cards.missed"), block?.missed, "bad", (reveal) => reveal("calls", { calls: "missed" }), unavailable),
    countCard(t("cards.ai"), block?.aiHandled, "good", (reveal) => reveal("ai", { calls: "ai" }), unavailable),
    countCard(t("cards.transferred"), block?.transferred, "neutral", (reveal) => reveal("calls", { calls: "transferred" }), unavailable),
    countCard(t("cards.followUp"), block?.followUp, "bad", (reveal) => reveal("calls", { calls: "followUp" }), unavailable),
  ];
}

function leadCards(data: DashboardOverview, t: (key: string) => string): CardModel[] {
  const leadHint = data.sources.leads === "error" ? t("unavailable") : undefined;
  const recoveryHint = data.sources.recovery === "unlinked" ? t("notLinkedShort") : t("unavailable");
  return [
    data.leads
      ? { label: t("cards.leads"), value: String(data.leads.captured.current), delta: data.leads.captured, tone: "good", onOpen: (reveal) => reveal("leads", { leads: "all" }), hint: leadHint }
      : countCard(t("cards.leads"), null, "good", (reveal) => reveal("leads"), t("unavailable")),
    countCard(t("cards.recovered"), data.recovery?.recovered, "good", (reveal) => reveal("leads"), recoveryHint),
    countCard(t("cards.missedLeads"), data.recovery?.missedCallLeads, "neutral", (reveal) => reveal("leads"), recoveryHint),
    countCard(t("cards.replied"), data.recovery?.replied, "good", (reveal) => reveal("leads"), recoveryHint),
    countCard(t("cards.attention"), data.recovery?.needsAttention, "bad", (reveal) => reveal("leads"), recoveryHint),
    countCard(t("cards.jobs"), data.recovery?.jobsAccepted, "good", (reveal) => reveal("leads"), recoveryHint),
  ];
}

function appointmentCards(data: DashboardOverview, t: (key: string) => string): CardModel[] {
  const unavailable = t("unavailable");
  const block = data.appointments;
  return [
    countCard(t("cards.booked"), block?.booked, "good", (reveal) => reveal("appointments", { appointments: "all" }), unavailable),
    countCard(t("cards.completed"), block?.completed, "good", (reveal) => reveal("appointments", { appointments: "completed" }), unavailable),
    countCard(t("cards.canceled"), block?.canceled, "bad", (reveal) => reveal("appointments", { appointments: "canceled" }), unavailable),
    countCard(t("cards.aiBooked"), block?.aiBooked, "good", (reveal) => reveal("appointments"), unavailable),
    {
      label: t("cards.upcoming"),
      value: block ? String(block.upcoming) : "—",
      hint: t("upcomingNote"),
      delta: null,
      tone: "neutral",
      onOpen: (reveal) => reveal("appointments"),
    },
  ];
}

function moneyCards(
  data: DashboardOverview,
  t: (key: string) => string,
  locale: "en" | "fr",
): CardModel[] {
  const cards: CardModel[] = [];
  if (data.recovery) {
    const amount = data.recovery.estimatedValue;
    cards.push({
      label: t("cards.estimate"),
      value: formatMoney(amount.current, locale),
      hint: amount.current == null ? t("noAmount") : t("estimateNote"),
      delta: amount.current == null ? null : {
        current: amount.current,
        previous: amount.previous ?? 0,
        changePct: amount.changePct,
      },
      tone: "neutral",
      onOpen: (reveal) => reveal("leads"),
    });
  }
  if (data.sources.revenue === "ready" && data.recordedRevenue) {
    const amount = data.recordedRevenue;
    cards.push({
      label: t("cards.recorded"),
      value: formatMoney(amount.current, locale),
      hint: amount.current == null ? t("noAmount") : t("recordedNote"),
      delta: amount.current == null ? null : {
        current: amount.current,
        previous: amount.previous ?? 0,
        changePct: amount.changePct,
      },
      tone: "neutral",
      onOpen: (reveal) => reveal("leads"),
    });
  }
  if (data.sources.pipeline === "ready") {
    cards.push({
      label: t("cards.pipeline"),
      value: formatMoney(data.pipelineEstimate, locale),
      hint: data.pipelineEstimate == null ? t("noAmount") : t("pipelineNote"),
      delta: null,
      tone: "neutral",
      onOpen: (reveal) => reveal("leads"),
    });
  }
  if (data.reviewsSent) {
    cards.push(countCard(t("cards.reviews"), data.reviewsSent, "neutral", (reveal) => reveal("activity"), t("unavailable")));
  }
  return cards;
}

function bookingSourceLabel(t: (key: string) => string, source: string): string {
  const known = ["ai_receptionist", "manual", "dashboard", "simulation"];
  return known.includes(source) ? t(`sources.${source}`) : source;
}

function activityDetail(
  item: DashboardOverview["activity"][number],
  t: (key: string) => string,
  crm: (key: string) => string,
): string {
  if (item.kind === "lead") return crm(`statuses.${item.detail}`);
  if (item.kind === "appointment") return t(`appointmentStatus.${item.detail}`);
  if (item.kind === "call" || item.kind === "recovery") {
    const outcomes = [
      "message_taken",
      "appointment_requested",
      "appointment_booked",
      "transferred",
      "emergency_transferred",
      "faq_answered",
      "voicemail",
      "caller_hung_up",
      "failed",
      "open",
      "technician_accepted",
      "technician_declined",
      "customer_unreachable",
      "resolved",
      "cancelled",
      "human_review",
      "answered",
      "missed",
    ];
    if (outcomes.includes(item.detail)) return t(`outcomes.${item.detail}`);
  }
  return item.detail;
}
