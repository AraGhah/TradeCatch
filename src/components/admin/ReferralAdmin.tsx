"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocale } from "next-intl";
import type {
  ReferralEvent,
  ReferralRecord,
  ReferralSettings,
  RewardRecord,
} from "@/product/referrals/model";

type Snapshot = {
  settings: ReferralSettings;
  rows: { referral: ReferralRecord; reward: RewardRecord | null }[];
  counts: { pending: number; approved: number; issued: number; rejected: number; referrals: number };
};

const PLANS = ["starter", "growth", "receptionist"] as const;

const copy = {
  en: {
    title: "Referral program",
    notice:
      "Interac e-Transfers are never sent automatically. Approve a reward, send the Interac yourself, then record the confirmation reference here. Recording needs a fulfillment method (below).",
    load: "Loading referrals…",
    error: "Referral data could not be loaded.",
    retry: "Retry",
    refresh: "Refresh",
    counts: { referrals: "Referrals", pending: "Pending", approved: "Approved", issued: "Issued", rejected: "Rejected" },
    settingsTitle: "Program settings",
    enabled: "Program enabled",
    rewards: "Interac e-Transfer by plan purchased (CAD)",
    plans: { starter: "Starter", growth: "Growth", receptionist: "Receptionist Plus" },
    eligible: "Plans that earn a reward",
    holdDays: "Days to hold a reward after payment",
    requireReferrer: "Referrer must still be an active customer",
    fulfillment: "Interac fulfillment",
    fulfillmentOptions: { none: "Not configured (cannot mark issued)", manual: "Manual (an administrator sends the Interac)" },
    saveSettings: "Save settings",
    reconcile: "Re-check payments",
    reconcileDone: (n: number) => `${n} referral(s) newly qualified.`,
    linkTitle: "Link a business to a referral code",
    organizationId: "Business ID",
    code: "Referral code",
    link: "Link referral",
    listTitle: "Referrals and rewards",
    empty: "No referrals yet.",
    cols: { referrer: "Referrer", referred: "Referred business", registered: "Signed up", status: "Referral", reward: "Reward", actions: "Actions" },
    referralStatus: { registered: "Signed up", qualified: "Paying customer", rejected: "Rejected" },
    rewardStatus: { pending: "Pending", approved: "Approved", issued: "Issued", rejected: "Rejected" },
    eligibleOn: "Approvable from",
    reference: "Interac confirmation reference",
    note: "Reason (5+ characters)",
    acknowledge: "I reviewed the flags",
    approve: "Approve",
    reject: "Reject",
    issue: "Mark issued",
    history: "History",
    hideHistory: "Hide history",
    saved: "Saved.",
    failed: "The change could not be saved. Refresh before retrying.",
    flags: {
      same_email_domain: "Same company email domain as the referrer",
      same_business_name: "Same business name as the referrer",
      partial_refund: "Partially refunded",
      billing_suspended: "Billing suspended",
      clawback_review: "Refunded or disputed after the Interac was issued",
      test_payment: "Stripe test-mode payment (cannot be approved)",
    } as Record<string, string>,
    errors: {
      not_found: "Reward not found.",
      not_pending: "This reward is no longer pending.",
      not_approved: "This reward is not in the approved state.",
      test_payment_not_approvable: "A test-mode payment can never be approved.",
      hold_period_active: "The hold period is not over yet.",
      referred_inactive: "The referred customer is no longer active.",
      referrer_inactive: "The referrer is no longer an active customer.",
      referrer_is_demo: "The referrer is a demo workspace.",
      payment_unverified: "Stripe could not confirm the payment. Try again shortly.",
      payment_reversed: "Stripe shows the payment was refunded or disputed. The reward was rejected.",
      flags_require_acknowledgement: "Review the flags and tick the acknowledgement box.",
      fulfillment_not_configured: "Set a fulfillment method in the settings first.",
      invalid_reference: "Enter the Interac confirmation reference (not bank credentials).",
      reference_already_used: "That Interac reference is already recorded on another reward.",
      invalid_note: "Enter a reason of at least 5 characters.",
      invalid_settings: "Those settings are not valid.",
    } as Record<string, string>,
  },
  fr: {
    title: "Programme de parrainage",
    notice:
      "Les Interac ne sont jamais envoyés automatiquement. Approuvez une récompense, envoyez l’Interac vous-même, puis inscrivez ici la référence de confirmation. L’inscription exige un mode d’envoi (ci-dessous).",
    load: "Chargement des parrainages…",
    error: "Les données de parrainage n’ont pas pu être chargées.",
    retry: "Réessayer",
    refresh: "Actualiser",
    counts: { referrals: "Parrainages", pending: "En attente", approved: "Approuvées", issued: "Émises", rejected: "Refusées" },
    settingsTitle: "Paramètres du programme",
    enabled: "Programme activé",
    rewards: "Interac selon le forfait acheté (CAD)",
    plans: { starter: "Starter", growth: "Growth", receptionist: "Réceptionniste Plus" },
    eligible: "Forfaits qui donnent une récompense",
    holdDays: "Jours de rétention après le paiement",
    requireReferrer: "Le parrain doit rester un client actif",
    fulfillment: "Envoi des Interac",
    fulfillmentOptions: { none: "Non configuré (impossible de marquer comme émise)", manual: "Manuel (un administrateur envoie l’Interac)" },
    saveSettings: "Enregistrer les paramètres",
    reconcile: "Revérifier les paiements",
    reconcileDone: (n: number) => `${n} parrainage(s) nouvellement admissible(s).`,
    linkTitle: "Lier une entreprise à un code de parrainage",
    organizationId: "ID de l’entreprise",
    code: "Code de parrainage",
    link: "Lier le parrainage",
    listTitle: "Parrainages et récompenses",
    empty: "Aucun parrainage pour le moment.",
    cols: { referrer: "Parrain", referred: "Entreprise parrainée", registered: "Inscription", status: "Parrainage", reward: "Récompense", actions: "Actions" },
    referralStatus: { registered: "Inscrit", qualified: "Client payant", rejected: "Refusé" },
    rewardStatus: { pending: "En attente", approved: "Approuvée", issued: "Émise", rejected: "Refusée" },
    eligibleOn: "Approuvable dès le",
    reference: "Référence de confirmation Interac",
    note: "Motif (5 caractères ou plus)",
    acknowledge: "J’ai examiné les signalements",
    approve: "Approuver",
    reject: "Refuser",
    issue: "Marquer comme émise",
    history: "Historique",
    hideHistory: "Masquer l’historique",
    saved: "Enregistré.",
    failed: "Le changement n’a pas pu être enregistré. Actualisez avant de réessayer.",
    flags: {
      same_email_domain: "Même domaine de courriel d’entreprise que le parrain",
      same_business_name: "Même nom d’entreprise que le parrain",
      partial_refund: "Remboursement partiel",
      billing_suspended: "Facturation suspendue",
      clawback_review: "Remboursé ou contesté après l’envoi de l’Interac",
      test_payment: "Paiement Stripe en mode test (ne peut pas être approuvé)",
    } as Record<string, string>,
    errors: {
      not_found: "Récompense introuvable.",
      not_pending: "Cette récompense n’est plus en attente.",
      not_approved: "Cette récompense n’est pas à l’état approuvé.",
      test_payment_not_approvable: "Un paiement en mode test ne peut jamais être approuvé.",
      hold_period_active: "La période de rétention n’est pas terminée.",
      referred_inactive: "Le client parrainé n’est plus actif.",
      referrer_inactive: "Le parrain n’est plus un client actif.",
      referrer_is_demo: "Le parrain est un espace de démonstration.",
      payment_unverified: "Stripe n’a pas pu confirmer le paiement. Réessayez sous peu.",
      payment_reversed: "Stripe indique que le paiement a été remboursé ou contesté. La récompense a été refusée.",
      flags_require_acknowledgement: "Examinez les signalements et cochez la case de confirmation.",
      fulfillment_not_configured: "Choisissez d’abord un mode d’envoi dans les paramètres.",
      invalid_reference: "Entrez la référence de confirmation Interac (pas d’identifiants bancaires).",
      reference_already_used: "Cette référence Interac est déjà inscrite sur une autre récompense.",
      invalid_note: "Entrez un motif d’au moins 5 caractères.",
      invalid_settings: "Ces paramètres ne sont pas valides.",
    } as Record<string, string>,
  },
};

const INPUT = "rounded-md border border-navy/20 bg-white px-2 py-1.5 text-sm text-navy";
const BUTTON =
  "rounded-md border border-navy/20 bg-white px-3 py-1.5 text-sm font-medium text-navy hover:bg-navy/5 disabled:opacity-50";

const dollars = (cents: number) => (cents / 100).toFixed(2);

export function ReferralAdmin() {
  const locale = useLocale() === "fr" ? "fr" : "en";
  const t = copy[locale];
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<ReferralSettings | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const [events, setEvents] = useState<Record<string, ReferralEvent[] | null>>({});
  const [linkOrg, setLinkOrg] = useState("");
  const [linkCode, setLinkCode] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch("/api/admin/referrals", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const body = (await response.json()) as Snapshot;
      setData(body);
      setDraft(body.settings);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial authenticated client fetch; event-driven refreshes share this loader.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function send(command: Record<string, unknown>, okMessage: string | ((body: Record<string, unknown>) => string)) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        const code = typeof body.error === "string" ? body.error : "";
        setMessage(t.errors[code] ?? t.failed);
      } else {
        setMessage(typeof okMessage === "function" ? okMessage(body) : okMessage);
      }
      await load();
    } catch {
      setMessage(t.failed);
    } finally {
      setBusy(false);
    }
  }

  async function toggleHistory(rewardId: string) {
    if (events[rewardId]) {
      setEvents((prev) => ({ ...prev, [rewardId]: null }));
      return;
    }
    const response = await fetch(`/api/admin/referrals?rewardId=${encodeURIComponent(rewardId)}`, {
      cache: "no-store",
    });
    if (!response.ok) return;
    const body = (await response.json()) as { events: ReferralEvent[] };
    setEvents((prev) => ({ ...prev, [rewardId]: body.events }));
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    void send(
      {
        action: "settings",
        settings: {
          programEnabled: draft.programEnabled,
          rewardsCents: draft.rewardsCents,
          eligiblePlans: draft.eligiblePlans,
          holdDays: draft.holdDays,
          requireReferrerActive: draft.requireReferrerActive,
          fulfillmentMethod: draft.fulfillmentMethod,
        },
      },
      t.saved,
    );
  }

  function linkReferral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send({ action: "link", organizationId: linkOrg.trim(), code: linkCode.trim() }, t.saved);
  }

  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", { dateStyle: "medium" }).format(new Date(iso));
  const money = (cents: number) =>
    new Intl.NumberFormat(locale === "fr" ? "fr-CA" : "en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);

  if (loading && !data) return <p className="text-navy/70">{t.load}</p>;
  if (error || !data || !draft) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-red-700">{t.error}</p>
        <button type="button" className={BUTTON} onClick={() => void load()}>{t.retry}</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{t.title}</h1>
          <p className="mt-2 max-w-[48em] text-sm text-navy/70">{t.notice}</p>
        </div>
        <button type="button" className={BUTTON} onClick={() => void load()} disabled={loading}>{t.refresh}</button>
      </header>

      <p className="min-h-5 text-sm text-navy" role="status" aria-live="polite">{message}</p>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {(["referrals", "pending", "approved", "issued", "rejected"] as const).map((key) => (
          <div key={key} className="rounded-md border border-navy/10 bg-white px-4 py-3">
            <dt className="text-sm text-navy/70">{t.counts[key]}</dt>
            <dd className="text-2xl font-extrabold text-navy">{data.counts[key]}</dd>
          </div>
        ))}
      </dl>

      <form onSubmit={saveSettings} className="flex flex-col gap-4 rounded-md border border-navy/10 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">{t.settingsTitle}</h2>
        <label className="flex items-center gap-2 text-sm text-navy">
          <input type="checkbox" checked={draft.programEnabled} onChange={(e) => setDraft({ ...draft, programEnabled: e.target.checked })} />
          {t.enabled}
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-navy">{t.rewards}</legend>
          <div className="flex flex-wrap gap-4">
            {PLANS.map((plan) => (
              <label key={plan} className="flex flex-col gap-1 text-sm text-navy">
                {t.plans[plan]}
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step="0.01"
                  className={INPUT}
                  value={dollars(draft.rewardsCents[plan])}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      rewardsCents: { ...draft.rewardsCents, [plan]: Math.round(Number(e.target.value) * 100) || 0 },
                    })
                  }
                />
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-navy">{t.eligible}</legend>
          <div className="flex flex-wrap gap-4">
            {PLANS.map((plan) => (
              <label key={plan} className="flex items-center gap-2 text-sm text-navy">
                <input
                  type="checkbox"
                  checked={draft.eligiblePlans.includes(plan)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      eligiblePlans: e.target.checked
                        ? [...draft.eligiblePlans, plan]
                        : draft.eligiblePlans.filter((p) => p !== plan),
                    })
                  }
                />
                {t.plans[plan]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-6">
          <label className="flex flex-col gap-1 text-sm text-navy">
            {t.holdDays}
            <input type="number" min={0} max={120} className={`${INPUT} w-28`} value={draft.holdDays}
              onChange={(e) => setDraft({ ...draft, holdDays: Math.max(0, Math.min(120, Math.trunc(Number(e.target.value)) || 0)) })} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-navy">
            {t.fulfillment}
            <select className={INPUT} value={draft.fulfillmentMethod}
              onChange={(e) => setDraft({ ...draft, fulfillmentMethod: e.target.value as ReferralSettings["fulfillmentMethod"] })}>
              <option value="none">{t.fulfillmentOptions.none}</option>
              <option value="manual">{t.fulfillmentOptions.manual}</option>
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-navy">
          <input type="checkbox" checked={draft.requireReferrerActive} onChange={(e) => setDraft({ ...draft, requireReferrerActive: e.target.checked })} />
          {t.requireReferrer}
        </label>
        <div className="flex gap-2">
          <button type="submit" className={BUTTON} disabled={busy}>{t.saveSettings}</button>
          <button type="button" className={BUTTON} disabled={busy}
            onClick={() => void send({ action: "reconcile" }, (body) => t.reconcileDone(Number(body.qualified) || 0))}>
            {t.reconcile}
          </button>
        </div>
      </form>

      <form onSubmit={linkReferral} className="flex flex-wrap items-end gap-3 rounded-md border border-navy/10 bg-white px-5 py-4">
        <h2 className="w-full text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">{t.linkTitle}</h2>
        <label className="flex flex-col gap-1 text-sm text-navy">
          {t.organizationId}
          <input className={INPUT} value={linkOrg} onChange={(e) => setLinkOrg(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm text-navy">
          {t.code}
          <input className={`${INPUT} font-mono`} value={linkCode} maxLength={10} onChange={(e) => setLinkCode(e.target.value.toUpperCase())} required />
        </label>
        <button type="submit" className={BUTTON} disabled={busy}>{t.link}</button>
      </form>

      <section className="rounded-md border border-navy/10 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">{t.listTitle}</h2>
        {data.rows.length === 0 ? (
          <p className="mt-3 text-sm text-navy/70">{t.empty}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm text-navy">
              <thead>
                <tr className="border-b border-navy/10 text-navy/60">
                  {(["referrer", "referred", "registered", "status", "reward", "actions"] as const).map((col) => (
                    <th key={col} scope="col" className="py-2 pr-3 font-medium">{t.cols[col]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map(({ referral, reward }) => {
                  const flags = [...new Set([...(referral.reviewFlags ?? []), ...(reward?.reviewFlags ?? [])])];
                  return (
                    <tr key={referral.id} className="border-b border-navy/5 align-top last:border-0">
                      <td className="py-2 pr-3">{referral.referrerBusinessName}<br /><span className="text-xs text-navy/50">{referral.referrerOrganizationId}</span></td>
                      <td className="py-2 pr-3">{referral.referredBusinessName}<br /><span className="text-xs text-navy/50">{referral.referredOrganizationId}</span></td>
                      <td className="py-2 pr-3">{date(referral.registeredAt)}</td>
                      <td className="py-2 pr-3">
                        {t.referralStatus[referral.status]}
                        {referral.rejectionReason ? <span className="block text-xs text-red-700">{referral.rejectionReason}</span> : null}
                      </td>
                      <td className="py-2 pr-3">
                        {reward ? (
                          <>
                            <strong>{money(reward.amountCents)}</strong> · {t.plans[reward.plan]}
                            <span className="block">{t.rewardStatus[reward.status]}{reward.livemode ? "" : " (test)"}</span>
                            {reward.status === "pending" ? <span className="block text-xs text-navy/60">{t.eligibleOn} {date(reward.eligibleAt)}</span> : null}
                            {reward.giftCardReference ? <span className="block font-mono text-xs">{reward.giftCardReference}</span> : null}
                            {reward.rejectionReason ? <span className="block text-xs text-red-700">{reward.rejectionReason}</span> : null}
                          </>
                        ) : "—"}
                        {flags.length > 0 ? (
                          <ul className="mt-1 list-disc pl-4 text-xs text-amber-800">
                            {flags.map((flag) => <li key={flag}>{t.flags[flag] ?? flag}</li>)}
                          </ul>
                        ) : null}
                      </td>
                      <td className="py-2">
                        {reward ? (
                          <div className="flex min-w-56 flex-col gap-2">
                            {reward.status === "pending" ? (
                              <>
                                {flags.filter((f) => f !== "test_payment").length > 0 ? (
                                  <label className="flex items-center gap-2 text-xs">
                                    <input type="checkbox" checked={!!acknowledged[reward.id]} onChange={(e) => setAcknowledged({ ...acknowledged, [reward.id]: e.target.checked })} />
                                    {t.acknowledge}
                                  </label>
                                ) : null}
                                <button type="button" className={BUTTON} disabled={busy}
                                  onClick={() => void send({ action: "approve", rewardId: reward.id, acknowledgeFlags: !!acknowledged[reward.id] }, t.saved)}>
                                  {t.approve}
                                </button>
                              </>
                            ) : null}
                            {reward.status === "approved" ? (
                              <div className="flex flex-col gap-1">
                                <input className={INPUT} aria-label={t.reference} placeholder={t.reference} maxLength={80}
                                  value={references[reward.id] ?? ""} onChange={(e) => setReferences({ ...references, [reward.id]: e.target.value })} />
                                <button type="button" className={BUTTON} disabled={busy || !(references[reward.id] ?? "").trim()}
                                  onClick={() => void send({ action: "issue", rewardId: reward.id, giftCardReference: references[reward.id] ?? "" }, t.saved)}>
                                  {t.issue}
                                </button>
                              </div>
                            ) : null}
                            {reward.status === "pending" || reward.status === "approved" ? (
                              <div className="flex flex-col gap-1">
                                <input className={INPUT} aria-label={t.note} placeholder={t.note} maxLength={500}
                                  value={notes[reward.id] ?? ""} onChange={(e) => setNotes({ ...notes, [reward.id]: e.target.value })} />
                                <button type="button" className={BUTTON} disabled={busy || (notes[reward.id] ?? "").trim().length < 5}
                                  onClick={() => void send({ action: "reject", rewardId: reward.id, note: notes[reward.id] ?? "" }, t.saved)}>
                                  {t.reject}
                                </button>
                              </div>
                            ) : null}
                            <button type="button" className="w-fit text-xs underline" onClick={() => void toggleHistory(reward.id)}>
                              {events[reward.id] ? t.hideHistory : t.history}
                            </button>
                            {events[reward.id] ? (
                              <ol className="flex flex-col gap-1 text-xs text-navy/70">
                                {events[reward.id]!.map((entry) => (
                                  <li key={entry.id}>{date(entry.at)} · {entry.action} · {entry.actor}{entry.detail ? ` · ${entry.detail}` : ""}</li>
                                ))}
                              </ol>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
