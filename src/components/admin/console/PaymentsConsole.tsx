"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import type { BillingEventRow } from "@/product/admin-console/billing-db";
import type { PaymentsResult } from "@/product/admin-console/billing-views";
import { queryString, useAdminData } from "./api";
import {
  Badge,
  BusinessSelect,
  CursorPager,
  DataState,
  DataTable,
  Field,
  FilterBar,
  Notice,
  PageHeader,
  Pager,
  Tile,
  card,
  formatDate,
  formatDateTime,
  formatMoney,
  inputClass,
  useCommon,
  useLoadErrorText,
  useLocaleTag,
  type Column,
  type Tone,
} from "./ui";

const en = {
  title: "Payments",
  intro:
    "Invoices and payment history from Stripe, plus every payment outcome Stripe has reported to TradeCatch. A failed payment stays visible here even if Stripe cannot be reached.",
  outstanding: "Outstanding balance",
  outstandingNote: "Open invoices not yet paid",
  overdue: "Overdue",
  openInvoices: "open invoices",
  noOutstanding: "No outstanding balance",
  noOutstandingNote: "Every invoice Stripe holds is paid or closed.",
  eventsTitle: "Payment events",
  eventsIntro: "Reported by Stripe and recorded when each one arrived.",
  invoicesTitle: "Invoices (Stripe)",
  business: "Business",
  invoiceStatus: "Invoice status",
  outcome: "Payment outcome",
  when: "When",
  result: "Outcome",
  amount: "Amount",
  attempt: "Attempt",
  nextAttempt: "Next retry",
  invoice: "Invoice",
  status: "Status",
  due: "Due",
  paid: "Paid",
  remaining: "Remaining",
  created: "Created",
  view: "View",
  unknownBusiness: "Unknown business",
  eventsCaption: "Payment events",
  invoicesCaption: "Stripe invoices",
  eventsEmpty: "No payment events match these filters.",
  invoicesEmpty: "No invoices match these filters.",
  invoicesUnavailable: "Invoices are unavailable.",
  loadError: "Payments could not be loaded.",
  outcomes: { failed: "Failed", action_required: "Action required", succeeded: "Paid" } as Record<string, string>,
  outcomeFilters: { "": "All outcomes", failed: "Failed", action_required: "Action required", succeeded: "Paid" } as Record<string, string>,
  invoiceStatuses: { all: "All invoices", open: "Open", paid: "Paid", uncollectible: "Uncollectible", void: "Void", draft: "Draft" } as Record<string, string>,
};
type Copy = typeof en;
const fr: Copy = {
  title: "Paiements",
  intro:
    "Factures et historique de paiement selon Stripe, ainsi que chaque résultat de paiement que Stripe a communiqué à TradeCatch. Un paiement échoué reste visible ici même si Stripe est injoignable.",
  outstanding: "Solde impayé",
  outstandingNote: "Factures ouvertes non payées",
  overdue: "En retard",
  openInvoices: "factures ouvertes",
  noOutstanding: "Aucun solde impayé",
  noOutstandingNote: "Chaque facture détenue par Stripe est payée ou fermée.",
  eventsTitle: "Événements de paiement",
  eventsIntro: "Communiqués par Stripe et consignés à leur arrivée.",
  invoicesTitle: "Factures (Stripe)",
  business: "Entreprise",
  invoiceStatus: "Statut de la facture",
  outcome: "Résultat du paiement",
  when: "Date",
  result: "Résultat",
  amount: "Montant",
  attempt: "Tentative",
  nextAttempt: "Prochaine reprise",
  invoice: "Facture",
  status: "Statut",
  due: "Échéance",
  paid: "Payé",
  remaining: "Restant",
  created: "Créée",
  view: "Voir",
  unknownBusiness: "Entreprise inconnue",
  eventsCaption: "Événements de paiement",
  invoicesCaption: "Factures Stripe",
  eventsEmpty: "Aucun événement de paiement ne correspond à ces filtres.",
  invoicesEmpty: "Aucune facture ne correspond à ces filtres.",
  invoicesUnavailable: "Les factures sont indisponibles.",
  loadError: "Les paiements n’ont pas pu être chargés.",
  outcomes: { failed: "Échoué", action_required: "Action requise", succeeded: "Payé" },
  outcomeFilters: { "": "Tous les résultats", failed: "Échoué", action_required: "Action requise", succeeded: "Payé" },
  invoiceStatuses: { all: "Toutes les factures", open: "Ouverte", paid: "Payée", uncollectible: "Irrécouvrable", void: "Annulée", draft: "Brouillon" },
};

type EventRow = BillingEventRow & { organizationName: string | null };
type Response = {
  ok: true;
  generatedAt: string;
  invoices: PaymentsResult | null;
  invoicesError: string | null;
  events: { rows: EventRow[]; total: number; page: number; pageSize: number; pages: number };
};
type InvoiceRow = PaymentsResult["invoices"][number];

const OUTCOME_TONE: Record<string, Tone> = { failed: "bad", action_required: "warn", succeeded: "good" };
const INVOICE_TONE: Record<string, Tone> = { paid: "good", open: "warn", uncollectible: "bad", void: "neutral", draft: "neutral" };

const safeHref = (value: string | null) => (value && /^https:\/\//.test(value) ? value : null);

export function PaymentsConsole() {
  const locale = useLocaleTag();
  const t: Copy = locale === "fr" ? fr : en;
  const common = useCommon();
  const loadError = useLoadErrorText();

  const [businessId, setBusinessId] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState("all");
  const [outcome, setOutcome] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [cursors, setCursors] = useState<string[]>([]);
  const after = cursors[cursors.length - 1];

  const url = `/api/admin/payments${queryString({ status: invoiceStatus, outcome, businessId, from, to, page, after, pageSize: 20 })}`;
  const { data, error, loading, refresh, updatedAt } = useAdminData<Response>(url);

  const reset = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(1);
    setCursors([]);
  };

  const eventColumns: Column<EventRow>[] = [
    { id: "when", header: t.when, primary: true, cell: (row) => formatDateTime(row.createdAt, locale) },
    {
      id: "business",
      header: t.business,
      cell: (row) =>
        row.organizationId ? (
          <Link href={{ pathname: "/admin/businesses/[id]", params: { id: row.organizationId } }} className="font-semibold text-navy underline">
            {row.organizationName ?? row.organizationId}
          </Link>
        ) : (
          <span className="text-navy/70">{t.unknownBusiness}</span>
        ),
    },
    { id: "result", header: t.result, cell: (row) => <Badge tone={OUTCOME_TONE[row.outcome] ?? "neutral"}>{t.outcomes[row.outcome] ?? row.outcome}</Badge> },
    { id: "amount", header: t.amount, cell: (row) => formatMoney(row.amountCents, row.currency, locale) },
    { id: "attempt", header: t.attempt, cell: (row) => row.attemptCount ?? "—" },
    { id: "next", header: t.nextAttempt, cell: (row) => formatDateTime(row.nextAttemptAt, locale) },
    { id: "invoice", header: t.invoice, cell: (row) => <code className="break-all text-xs">{row.invoiceId ?? "—"}</code> },
  ];

  const invoiceColumns: Column<InvoiceRow>[] = [
    {
      id: "invoice",
      header: t.invoice,
      primary: true,
      cell: (row) => {
        const href = safeHref(row.hostedInvoiceUrl);
        return (
          <>
            <span className="break-all">{row.number ?? row.id}</span>
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs font-normal underline">
                {t.view}
              </a>
            ) : null}
          </>
        );
      },
    },
    {
      id: "business",
      header: t.business,
      cell: (row) =>
        row.organization ? (
          <Link href={{ pathname: "/admin/businesses/[id]", params: { id: row.organization.id } }} className="font-semibold text-navy underline">
            {row.organization.name}
          </Link>
        ) : (
          <span className="break-all text-navy/70">{row.customerEmail ?? t.unknownBusiness}</span>
        ),
    },
    {
      id: "status",
      header: t.status,
      cell: (row) => {
        const overdue = row.status === "open" && row.dueDate != null && Date.parse(row.dueDate) < Date.parse(data?.generatedAt ?? "");
        return <Badge tone={overdue ? "bad" : (INVOICE_TONE[row.status] ?? "neutral")}>{t.invoiceStatuses[row.status] ?? row.status}{overdue ? ` · ${t.overdue}` : ""}</Badge>;
      },
    },
    { id: "due", header: t.amount, cell: (row) => formatMoney(row.amountDueCents, row.currency, locale) },
    { id: "paid", header: t.paid, cell: (row) => formatMoney(row.amountPaidCents, row.currency, locale) },
    { id: "remaining", header: t.remaining, cell: (row) => formatMoney(row.amountRemainingCents, row.currency, locale) },
    { id: "dueDate", header: t.due, cell: (row) => formatDate(row.dueDate, locale) },
    { id: "created", header: t.created, cell: (row) => formatDate(row.createdAt, locale) },
  ];

  const invoices = data?.invoices;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.title} intro={t.intro} onRefresh={refresh} loading={loading} updatedAt={updatedAt} />

      <FilterBar>
        <BusinessSelect id="pf-business" label={t.business} value={businessId} onChange={reset(setBusinessId)} />
        <Field label={t.invoiceStatus} htmlFor="pf-invoice">
          <select id="pf-invoice" value={invoiceStatus} onChange={(e) => reset(setInvoiceStatus)(e.target.value)} className={inputClass}>
            {Object.entries(t.invoiceStatuses).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label={t.outcome} htmlFor="pf-outcome">
          <select id="pf-outcome" value={outcome} onChange={(e) => reset(setOutcome)(e.target.value)} className={inputClass}>
            {Object.entries(t.outcomeFilters).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={common.from} htmlFor="pf-from">
            <input id="pf-from" type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} className={inputClass} />
          </Field>
          <Field label={common.to} htmlFor="pf-to">
            <input id="pf-to" type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} className={inputClass} />
          </Field>
        </div>
      </FilterBar>

      <DataState loading={loading} error={error} hasData={Boolean(data)} onRetry={refresh} errorText={loadError(error, t.loadError)}>
        {data ? (
          <>
            {invoices?.note ? <Notice tone={invoices.stripe.configured ? "info" : "warn"}>{invoices.note}</Notice> : null}
            {data.invoicesError ? <Notice tone="warn">{data.invoicesError}</Notice> : null}

            {invoices?.stripe.configured ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {invoices.outstanding.length === 0 ? (
                  <Tile label={t.outstanding} value={formatMoney(0, "CAD", locale)} tone="good" note={t.noOutstandingNote} />
                ) : (
                  invoices.outstanding.map((entry) => (
                    <Tile
                      key={entry.currency}
                      label={`${t.outstanding} (${entry.currency})`}
                      value={formatMoney(entry.outstandingCents, entry.currency, locale)}
                      tone={entry.overdueCents > 0 ? "bad" : "warn"}
                      note={`${entry.openInvoices} ${t.openInvoices}${entry.overdueCents > 0 ? ` · ${t.overdue}: ${formatMoney(entry.overdueCents, entry.currency, locale)}` : ""}`}
                    />
                  ))
                )}
              </div>
            ) : null}

            <section className={`${card} flex flex-col gap-3`} aria-labelledby="events-title">
              <div>
                <h2 id="events-title" className="font-semibold text-navy">{t.eventsTitle}</h2>
                <p className="text-sm text-navy/70">{t.eventsIntro}</p>
              </div>
              {data.events.rows.length === 0 ? (
                <p className="text-sm text-navy/70">{t.eventsEmpty}</p>
              ) : (
                <>
                  <DataTable columns={eventColumns} rows={data.events.rows} rowKey={(row) => row.eventId} caption={t.eventsCaption} />
                  <Pager page={data.events.page} pages={data.events.pages} total={data.events.total} onPage={setPage} busy={loading} />
                </>
              )}
            </section>

            <section className={`${card} flex flex-col gap-3`} aria-labelledby="invoices-title">
              <h2 id="invoices-title" className="font-semibold text-navy">{t.invoicesTitle}</h2>
              {!invoices ? (
                <p className="text-sm text-navy/70">{t.invoicesUnavailable}</p>
              ) : invoices.invoices.length === 0 ? (
                <p className="text-sm text-navy/70">{t.invoicesEmpty}</p>
              ) : (
                <>
                  <DataTable columns={invoiceColumns} rows={invoices.invoices} rowKey={(row) => row.id} caption={t.invoicesCaption} />
                  <CursorPager
                    hasPrevious={cursors.length > 0}
                    hasNext={invoices.invoicesHasMore && Boolean(invoices.invoicesNextCursor)}
                    busy={loading}
                    onFirst={() => setCursors([])}
                    onNext={() => {
                      const next = invoices.invoicesNextCursor;
                      if (next) setCursors((c) => [...c, next]);
                    }}
                  />
                </>
              )}
            </section>
          </>
        ) : null}
      </DataState>
    </div>
  );
}
