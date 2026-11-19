"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import type { SubscriptionsResult, SubscriptionView } from "@/product/admin-console/billing-views";
import type { SubscriptionAction } from "@/product/admin-console/stripe-admin";
import { adminFetch, queryString, useAdminAction, useAdminData, useAdminPermissions } from "./api";
import { SUBSCRIPTION_TONE } from "./BusinessesConsole";
import {
  Badge,
  ConfirmPanel,
  CursorPager,
  DataState,
  DataTable,
  Field,
  FilterBar,
  Notice,
  PageHeader,
  card,
  formatDate,
  formatMoney,
  inputClass,
  secondaryButton,
  dangerButton,
  useErrorText,
  useLoadErrorText,
  useLocaleTag,
  type Column,
} from "./ui";

const en = {
  title: "Subscriptions",
  intro:
    "Essential and Professional subscriptions as Stripe holds them: real prices, statuses and billing dates. Changes go through Stripe and are read back before they are shown as done.",
  pricesTitle: "Plan prices in Stripe",
  perMonth: "per month",
  catalog: "Catalog",
  matches: "Matches the catalog",
  differs: "Differs from the catalog",
  priceError: "Could not read this price",
  inactivePrice: "This Stripe price is archived",
  status: "Status",
  business: "Business",
  plan: "Plan",
  amount: "Amount",
  billing: "Next billing",
  sync: "TradeCatch record",
  actions: "Actions",
  inSync: "In sync",
  drift: "Differs: {fields}",
  notRecorded: "Not recorded yet",
  driftField: { status: "status", plan: "plan", cancellation: "cancellation" } as Record<string, string>,
  notLinked: "Not linked to a business",
  unknownPlan: "Unknown price",
  endsOn: "Ends {date}",
  renews: "Renews {date}",
  caption: "Subscriptions",
  switchTo: "Switch to {plan}",
  cancelAtEnd: "Cancel at period end",
  resume: "Resume",
  noActions: "No changes available",
  noAccess: "Your role can view subscriptions but not change them.",
  essential: "Essential",
  professional: "Professional",
  changeTitle: "Switch {business} from {from} to {to}?",
  changeBody:
    "The existing Stripe subscription is updated. Nothing is charged or refunded now: the new price ({price} per month) applies from the next invoice. The business's features change as soon as the update is confirmed.",
  cancelTitle: "Cancel {business} at the end of the billing period?",
  cancelBody:
    "The subscription stays active until {date}, then ends. The business keeps access until then and no refund is issued. You can resume it before that date.",
  resumeTitle: "Resume {business}'s subscription?",
  resumeBody: "The pending cancellation is removed and billing continues as normal.",
  confirmChange: "Change plan",
  confirmCancel: "Cancel at period end",
  confirmResume: "Resume subscription",
  doneChange: "Plan changed to {plan}.",
  doneCancel: "The subscription will end on the current period's last day.",
  doneResume: "The pending cancellation was removed.",
  synced: "Stripe and TradeCatch agree, and the business's features are up to date.",
  notSynced:
    "Stripe was updated, but TradeCatch has not confirmed it yet. Stripe's own notification will finish the job; refresh in a minute and check the TradeCatch record column.",
  entitlementsLag: "The business's recorded plan does not match yet. Refresh shortly to confirm.",
  loadError: "Subscriptions could not be loaded.",
  stripeUnavailable: "Stripe could not be reached. Nothing was changed; try again shortly.",
  errors: {
    invalid_state: "That subscription cannot be changed right now. It is not active, has more than one item, or is in a different Stripe mode.",
    same_plan: "It is already on that plan.",
    nothing_to_change: "Nothing to change: it is already in that state.",
    price_not_configured: "No Stripe price is configured for that plan on this server.",
    price_invalid: "The Stripe price for that plan is not a usable monthly price. Check its configuration in Stripe.",
    not_managed: "That subscription does not belong to a TradeCatch business.",
    not_found: "Stripe has no such subscription. Refresh the list.",
    unavailable: "Stripe could not be reached. Nothing was changed; check the subscription before retrying.",
    rejected: "Stripe refused the change. Nothing was changed.",
    confirm: "The confirmation word did not match.",
    stripe_unconfigured: "Stripe is not configured on this server.",
  } as Record<string, string>,
  statuses: {
    all: "All statuses", active: "Active", trialing: "Trial", past_due: "Past due", unpaid: "Unpaid",
    canceled: "Canceled", incomplete: "Incomplete", incomplete_expired: "Expired", paused: "Paused",
  } as Record<string, string>,
};
type Copy = typeof en;
const fr: Copy = {
  title: "Abonnements",
  intro:
    "Les abonnements Essentiel et Professionnel tels que Stripe les détient : vrais prix, statuts et dates de facturation. Les changements passent par Stripe et sont relus avant d’être présentés comme faits.",
  pricesTitle: "Prix des forfaits dans Stripe",
  perMonth: "par mois",
  catalog: "Catalogue",
  matches: "Correspond au catalogue",
  differs: "Diffère du catalogue",
  priceError: "Ce prix n’a pas pu être lu",
  inactivePrice: "Ce prix Stripe est archivé",
  status: "Statut",
  business: "Entreprise",
  plan: "Forfait",
  amount: "Montant",
  billing: "Prochaine facturation",
  sync: "Dossier TradeCatch",
  actions: "Actions",
  inSync: "Synchronisé",
  drift: "Écart : {fields}",
  notRecorded: "Pas encore enregistré",
  driftField: { status: "statut", plan: "forfait", cancellation: "annulation" },
  notLinked: "Non lié à une entreprise",
  unknownPlan: "Prix inconnu",
  endsOn: "Se termine le {date}",
  renews: "Renouvelé le {date}",
  caption: "Abonnements",
  switchTo: "Passer à {plan}",
  cancelAtEnd: "Annuler en fin de période",
  resume: "Reprendre",
  noActions: "Aucun changement possible",
  noAccess: "Votre rôle permet de consulter les abonnements, pas de les modifier.",
  essential: "Essentiel",
  professional: "Professionnel",
  changeTitle: "Faire passer {business} de {from} à {to}?",
  changeBody:
    "L’abonnement Stripe existant est mis à jour. Rien n’est facturé ni remboursé maintenant : le nouveau prix ({price} par mois) s’applique à partir de la prochaine facture. Les fonctions de l’entreprise changent dès que la mise à jour est confirmée.",
  cancelTitle: "Annuler {business} à la fin de la période de facturation?",
  cancelBody:
    "L’abonnement reste actif jusqu’au {date}, puis se termine. L’entreprise garde son accès d’ici là et aucun remboursement n’est émis. Vous pouvez le reprendre avant cette date.",
  resumeTitle: "Reprendre l’abonnement de {business}?",
  resumeBody: "L’annulation prévue est retirée et la facturation se poursuit normalement.",
  confirmChange: "Changer de forfait",
  confirmCancel: "Annuler en fin de période",
  confirmResume: "Reprendre l’abonnement",
  doneChange: "Forfait changé pour {plan}.",
  doneCancel: "L’abonnement se terminera le dernier jour de la période en cours.",
  doneResume: "L’annulation prévue a été retirée.",
  synced: "Stripe et TradeCatch concordent, et les fonctions de l’entreprise sont à jour.",
  notSynced:
    "Stripe a été mis à jour, mais TradeCatch ne l’a pas encore confirmé. La notification de Stripe terminera le travail; actualisez dans une minute et vérifiez la colonne Dossier TradeCatch.",
  entitlementsLag: "Le forfait enregistré de l’entreprise ne correspond pas encore. Actualisez sous peu pour confirmer.",
  loadError: "Les abonnements n’ont pas pu être chargés.",
  stripeUnavailable: "Stripe est injoignable. Rien n’a été modifié; réessayez sous peu.",
  errors: {
    invalid_state: "Cet abonnement ne peut pas être modifié maintenant. Il n’est pas actif, compte plus d’un élément ou est dans un autre mode Stripe.",
    same_plan: "Il est déjà sur ce forfait.",
    nothing_to_change: "Rien à changer : il est déjà dans cet état.",
    price_not_configured: "Aucun prix Stripe n’est configuré pour ce forfait sur ce serveur.",
    price_invalid: "Le prix Stripe de ce forfait n’est pas un prix mensuel utilisable. Vérifiez sa configuration dans Stripe.",
    not_managed: "Cet abonnement n’appartient à aucune entreprise TradeCatch.",
    not_found: "Stripe n’a pas cet abonnement. Actualisez la liste.",
    unavailable: "Stripe est injoignable. Rien n’a été modifié; vérifiez l’abonnement avant de réessayer.",
    rejected: "Stripe a refusé le changement. Rien n’a été modifié.",
    confirm: "Le mot de confirmation ne correspond pas.",
    stripe_unconfigured: "Stripe n’est pas configuré sur ce serveur.",
  },
  statuses: {
    all: "Tous les statuts", active: "Actif", trialing: "Essai", past_due: "En retard", unpaid: "Impayé",
    canceled: "Annulé", incomplete: "Incomplet", incomplete_expired: "Expiré", paused: "En pause",
  },
};

type Pending = { id: string; kind: SubscriptionAction; targetPlan?: "essential" | "professional" };
type ChangeResponse = {
  ok: true;
  organizationId: string;
  before: { plan: string | null };
  after: { plan: string | null };
  synchronized: boolean;
  entitlementsUpdated: boolean | null;
};

const CONFIRM_WORD: Record<SubscriptionAction, string> = {
  change_plan: "change plan",
  cancel_at_period_end: "cancel",
  resume: "resume",
};

const STATUS_FILTERS = ["all", "active", "trialing", "past_due", "unpaid", "canceled", "incomplete", "paused"];

export function SubscriptionsConsole() {
  const locale = useLocaleTag();
  const t: Copy = locale === "fr" ? fr : en;
  const errorText = useErrorText();
  const loadError = useLoadErrorText();
  const { can, known } = useAdminPermissions();

  const [status, setStatus] = useState("all");
  const [cursors, setCursors] = useState<string[]>([]);
  const after = cursors[cursors.length - 1];
  const url = `/api/admin/subscriptions${queryString({ status, after, pageSize: 20 })}`;
  const { data, error, loading, refresh, updatedAt } = useAdminData<SubscriptionsResult & { ok: true }>(url);

  const [pending, setPending] = useState<Pending | null>(null);
  const [outcome, setOutcome] = useState<{ tone: "good" | "warn"; lines: string[] } | null>(null);
  const action = useAdminAction();

  const planLabel = (plan: string | null) =>
    plan === "essential" ? t.essential : plan === "professional" ? t.professional : plan ? plan : t.unknownPlan;
  const priceFor = (plan: "essential" | "professional") => data?.prices.find((p) => p.plan === plan);
  const writable = known && can("billing.write");

  async function confirm(subscription: SubscriptionView, request: Pending, word: string) {
    const result = await action.run(() =>
      adminFetch<ChangeResponse>(`/api/admin/subscriptions/${encodeURIComponent(subscription.id)}`, {
        method: "POST",
        body: { action: request.kind, targetPlan: request.targetPlan, confirm: word },
      }),
    );
    if (!result) return;
    const lines = [
      request.kind === "change_plan"
        ? t.doneChange.replace("{plan}", planLabel(result.after.plan))
        : request.kind === "cancel_at_period_end"
          ? t.doneCancel
          : t.doneResume,
    ];
    const clean = result.synchronized && result.entitlementsUpdated !== false;
    lines.push(result.synchronized ? t.synced : t.notSynced);
    if (result.synchronized && result.entitlementsUpdated === false) lines.push(t.entitlementsLag);
    setOutcome({ tone: clean ? "good" : "warn", lines });
    setPending(null);
    refresh();
  }

  function actionsFor(subscription: SubscriptionView) {
    const changeable = ["active", "trialing"].includes(subscription.status) && subscription.organization;
    if (!writable || !changeable) return <span className="text-xs text-navy/70">{t.noActions}</span>;
    const targets = (["essential", "professional"] as const).filter((p) => p !== subscription.plan);
    const busy = action.pending;
    return (
      <div className="flex flex-wrap gap-2">
        {targets.map((target) => (
          <button
            key={target}
            type="button"
            className={secondaryButton}
            disabled={busy}
            onClick={() => {
              action.reset();
              setOutcome(null);
              setPending({ id: subscription.id, kind: "change_plan", targetPlan: target });
            }}
          >
            {t.switchTo.replace("{plan}", planLabel(target))}
          </button>
        ))}
        {subscription.cancelAtPeriodEnd ? (
          <button
            type="button"
            className={secondaryButton}
            disabled={busy}
            onClick={() => {
              action.reset();
              setOutcome(null);
              setPending({ id: subscription.id, kind: "resume" });
            }}
          >
            {t.resume}
          </button>
        ) : (
          <button
            type="button"
            className={dangerButton}
            disabled={busy}
            onClick={() => {
              action.reset();
              setOutcome(null);
              setPending({ id: subscription.id, kind: "cancel_at_period_end" });
            }}
          >
            {t.cancelAtEnd}
          </button>
        )}
      </div>
    );
  }

  function panelFor(subscription: SubscriptionView) {
    if (!pending || pending.id !== subscription.id) return null;
    const business = subscription.organization?.name ?? subscription.customerEmail ?? subscription.id;
    const failure = action.error ? errorText(action.error, t.errors) : undefined;
    if (pending.kind === "change_plan" && pending.targetPlan) {
      const price = priceFor(pending.targetPlan);
      return (
        <ConfirmPanel
          title={t.changeTitle
            .replace("{business}", business)
            .replace("{from}", planLabel(subscription.plan))
            .replace("{to}", planLabel(pending.targetPlan))}
          description={t.changeBody.replace("{price}", price?.unitAmountCents != null ? formatMoney(price.unitAmountCents, price.currency, locale) : "—")}
          word={CONFIRM_WORD.change_plan}
          confirmLabel={t.confirmChange}
          busy={action.pending}
          error={failure}
          onConfirm={(word) => void confirm(subscription, pending, word)}
          onCancel={() => { setPending(null); action.reset(); }}
        />
      );
    }
    if (pending.kind === "cancel_at_period_end") {
      return (
        <ConfirmPanel
          title={t.cancelTitle.replace("{business}", business)}
          description={t.cancelBody.replace("{date}", formatDate(subscription.currentPeriodEnd, locale))}
          word={CONFIRM_WORD.cancel_at_period_end}
          confirmLabel={t.confirmCancel}
          tone="danger"
          busy={action.pending}
          error={failure}
          onConfirm={(word) => void confirm(subscription, pending, word)}
          onCancel={() => { setPending(null); action.reset(); }}
        />
      );
    }
    return (
      <ConfirmPanel
        title={t.resumeTitle.replace("{business}", business)}
        description={t.resumeBody}
        word={CONFIRM_WORD.resume}
        confirmLabel={t.confirmResume}
        busy={action.pending}
        error={failure}
        onConfirm={(word) => void confirm(subscription, pending, word)}
        onCancel={() => { setPending(null); action.reset(); }}
      />
    );
  }

  const columns: Column<SubscriptionView>[] = [
    {
      id: "business",
      header: t.business,
      primary: true,
      cell: (row) =>
        row.organization ? (
          <>
            <Link href={{ pathname: "/admin/businesses/[id]", params: { id: row.organization.id } }} className="font-semibold text-navy underline">
              {row.organization.name}
            </Link>
            {row.customerEmail ? <span className="block break-all text-xs font-normal text-navy/70">{row.customerEmail}</span> : null}
          </>
        ) : (
          <>
            <span className="text-navy/70">{t.notLinked}</span>
            {row.customerEmail ? <span className="block break-all text-xs text-navy/70">{row.customerEmail}</span> : null}
          </>
        ),
    },
    { id: "plan", header: t.plan, cell: (row) => planLabel(row.plan) },
    {
      id: "status",
      header: t.status,
      cell: (row) => <Badge tone={SUBSCRIPTION_TONE[row.status] ?? "neutral"}>{t.statuses[row.status] ?? row.status}</Badge>,
    },
    {
      id: "amount",
      header: t.amount,
      cell: (row) =>
        row.unitAmountCents != null ? `${formatMoney(row.unitAmountCents, row.currency, locale)} / ${row.interval === "month" ? "mo" : (row.interval ?? "")}` : "—",
    },
    {
      id: "billing",
      header: t.billing,
      cell: (row) =>
        row.currentPeriodEnd
          ? (row.cancelAtPeriodEnd ? t.endsOn : t.renews).replace("{date}", formatDate(row.currentPeriodEnd, locale))
          : "—",
    },
    {
      id: "sync",
      header: t.sync,
      cell: (row) =>
        data?.source === "database" ? (
          <Badge tone="neutral">{t.inSync}</Badge>
        ) : row.drift.length === 0 ? (
          <Badge tone="good">{t.inSync}</Badge>
        ) : row.drift[0] === "not_recorded" ? (
          <Badge tone="warn">{t.notRecorded}</Badge>
        ) : (
          <Badge tone="bad">{t.drift.replace("{fields}", row.drift.map((d) => t.driftField[d] ?? d).join(", "))}</Badge>
        ),
    },
    { id: "actions", header: t.actions, cell: actionsFor },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.title} intro={t.intro} onRefresh={refresh} loading={loading} updatedAt={updatedAt} />

      {known && !writable ? <Notice tone="neutral">{t.noAccess}</Notice> : null}
      {outcome ? (
        <Notice tone={outcome.tone} onClose={() => setOutcome(null)}>
          {outcome.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </Notice>
      ) : null}

      <DataState
        loading={loading}
        error={error}
        hasData={Boolean(data)}
        onRetry={refresh}
        errorText={error?.status === 502 ? t.stripeUnavailable : loadError(error, t.loadError)}
      >
        {data ? (
          <>
            {data.note ? <Notice tone={data.stripe.configured ? "info" : "warn"}>{data.note}</Notice> : null}

            {data.prices.length > 0 ? (
              <div className={card}>
                <h2 className="font-semibold text-navy">{t.pricesTitle}</h2>
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {data.prices.map((price) => (
                    <li key={price.plan} className="rounded-md border border-navy/10 px-3 py-2 text-sm">
                      <p className="font-semibold text-navy">{planLabel(price.plan)}</p>
                      {price.unitAmountCents != null ? (
                        <p className="mt-1 text-navy">
                          {formatMoney(price.unitAmountCents, price.currency, locale)} {t.perMonth}
                        </p>
                      ) : (
                        <p className="mt-1 text-red-800">{price.error ?? t.priceError}</p>
                      )}
                      <p className="text-xs text-navy/70">
                        {t.catalog}: {formatMoney(price.catalogMonthlyCad * 100, "CAD", locale)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {price.matchesCatalog === true ? <Badge tone="good">{t.matches}</Badge> : null}
                        {price.matchesCatalog === false ? <Badge tone="warn">{t.differs}</Badge> : null}
                        {price.active === false ? <Badge tone="warn">{t.inactivePrice}</Badge> : null}
                        {price.priceId ? <code className="break-all text-xs text-navy/70">{price.priceId}</code> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <FilterBar>
              <Field label={t.status} htmlFor="sf-status">
                <select
                  id="sf-status"
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setCursors([]);
                    setPending(null);
                  }}
                  className={inputClass}
                >
                  {STATUS_FILTERS.map((value) => (
                    <option key={value} value={value}>{t.statuses[value]}</option>
                  ))}
                </select>
              </Field>
            </FilterBar>

            {data.subscriptions.length === 0 ? (
              <p className="rounded-md border border-navy/10 bg-white px-4 py-6 text-sm text-navy/70">—</p>
            ) : (
              <DataTable
                columns={columns}
                rows={data.subscriptions}
                rowKey={(row) => row.id}
                expanded={panelFor}
                caption={t.caption}
              />
            )}
            <CursorPager
              hasPrevious={cursors.length > 0}
              hasNext={data.hasMore && Boolean(data.nextCursor)}
              busy={loading}
              onFirst={() => { setCursors([]); setPending(null); }}
              onNext={() => { if (data.nextCursor) { setCursors((c) => [...c, data.nextCursor as string]); setPending(null); } }}
            />
          </>
        ) : null}
      </DataState>
    </div>
  );
}
