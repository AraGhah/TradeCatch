"use client";

import { useState } from "react";
import { BusyLabel } from "@/components/ui/Spinner";
import {
  PAYMENT_REQUEST_STATUSES,
  WEBSITE_PAYMENT_STATUSES,
  WEBSITE_REQUEST_STATUSES,
  canTransitionWebsitePayment,
  canTransitionWebsiteStatus,
  type WebsitePaymentStatus,
  type WebsiteRequest,
  type WebsiteRequestEvent,
  type WebsiteRequestStatus,
} from "@/product/website-services/model";
import { Link } from "@/i18n/navigation";
import {
  adminFetch,
  queryString,
  useAdminAction,
  useAdminData,
  useAdminPermissions,
  useDebounced,
} from "./api";
import {
  Badge,
  BusinessSelect,
  ConfirmPanel,
  DataState,
  DataTable,
  Field,
  FilterBar,
  Notice,
  PageHeader,
  Pager,
  card,
  formatDate,
  formatDateTime,
  formatMoney,
  inputClass,
  primaryButton,
  secondaryButton,
  useCommon,
  useErrorText,
  useLoadErrorText,
  useLocaleTag,
  type Column,
  type Tone,
} from "./ui";

const en = {
  title: "Website requests",
  intro:
    "Done-for-you website requests from customers and visitors. Review comes first: a request must be reviewed before it can be approved, and asking for payment only records the ask. Nobody is ever charged from this page.",
  search: "Search business, contact or email",
  status: "Status",
  payment: "Payment",
  all: "All",
  customer: "Customer",
  services: "Services",
  submitted: "Submitted",
  price: "Price",
  review: "Review",
  hide: "Close",
  caption: "Website requests",
  empty: "No website requests match these filters.",
  loadError: "Website requests could not be loaded.",
  statuses: {
    submitted: "Pending", in_review: "Under review", approved: "Approved", quoted: "Quote sent",
    in_progress: "In progress", delivered: "Completed", rejected: "Rejected", cancelled: "Cancelled",
  } as Record<string, string>,
  payments: { not_requested: "Not requested", requested: "Requested", paid: "Paid", waived: "Waived" } as Record<string, string>,
  paymentVerbs: { not_requested: "Withdraw payment request", requested: "Request payment", paid: "Mark as paid", waived: "Waive payment" } as Record<string, string>,
  focus: {
    mobile: "Mobile-friendly", contact_form: "Contact form", lead_capture: "Lead capture",
    tradecatch: "TradeCatch connection", design: "Design", content: "Content",
  } as Record<string, string>,
  types: { new: "New website", improve: "Improve existing" } as Record<string, string>,
  verbs: {
    startReview: "Start review", backToReview: "Back to review", approved: "Approve", quoted: "Send quote",
    in_progress: "Start work", delivered: "Mark completed", rejected: "Reject", cancelled: "Cancel request",
  } as Record<string, string>,
  contact: "Contact",
  phone: "Phone",
  website: "Current website",
  notes: "Customer notes",
  teamEmail: "Team email",
  notifications: { sent: "Sent", not_configured: "Not configured", failed: "Failed" } as Record<string, string>,
  notificationsNone: "Not recorded",
  scope: "Scope of work",
  scopeHint: "What will be built. Required before sending a quote or starting work.",
  finalPrice: "Final price (CAD)",
  priceHint: "Leave empty to use the published website service price.",
  reviewNote: "Internal note",
  reviewNoteHint: "Only the team sees this. Required to reject.",
  saveDetails: "Save scope, price and note",
  saving: "Saving…",
  nextSteps: "Move this request",
  paymentTitle: "Payment",
  paymentNote: "TradeCatch records payment here. It never charges the customer: payment is collected separately, then marked as paid.",
  noPaymentSteps: "No payment steps available.",
  paymentNeedsApproval: "Payment can be requested once the request is approved or quoted and has a price.",
  history: "History",
  historyEmpty: "No history yet.",
  readOnly: "Your role can read website requests but not change them.",
  rejectTitle: "Reject this request?",
  rejectBody: "This is final. The customer is emailed the reason below; the internal note stays with the team.",
  customerReason: "Reason sent to the customer",
  customerReasonHint: "Written for the customer: they receive it by email. 5 characters minimum.",
  approveBody: "The customer is emailed that their request is approved, with the next steps.",
  customerEmail: {
    sent: "The customer was emailed.",
    already_sent: "The customer had already been emailed about this decision.",
    failed: "The customer email could not be sent. Contact them directly.",
    not_configured: "Email is not configured on this server: the customer was not emailed.",
  } as Record<string, string>,
  customerEmailEvent: "Customer email ({status}): {result}",
  customerEmailResults: { sent: "sent", failed: "failed", not_configured: "not configured", already_sent: "already sent" } as Record<string, string>,
  cancelTitle: "Cancel this request?",
  cancelBody: "This is final. Any pending payment request is withdrawn.",
  moveTitle: "Move to “{status}”?",
  paymentConfirmTitle: "{verb}?",
  requestedBody: "Records that payment is requested. The customer is not charged by TradeCatch.",
  paidBody: "Records that you received payment. Nothing is charged by this action.",
  waivedBody: "Records that no payment is needed for this request.",
  withdrawBody: "Records that the payment request was withdrawn.",
  confirm: "Confirm",
  saved: "Saved.",
  event: {
    submitted: "Request submitted",
    notified: "Team email: {note}",
    status_changed: "Status: {from} → {to}",
    quote_updated: "Quote updated: {note}",
    payment_updated: "Payment: {note}",
    note: "Note: {note}",
  } as Record<string, string>,
  errors: {
    invalid_transition: "That status change is not allowed from the current status.",
    invalid_payment_transition: "That payment change is not allowed from the current payment status.",
    payment_not_allowed: "Payment can only be requested once the work is approved or quoted.",
    review_note_required: "Add the reason in the internal note before rejecting.",
    customer_reason_required: "Write the reason the customer will receive (5 characters minimum).",
    locked: "The agreed scope and price cannot be changed once work has started.",
    conflict: "This request changed while you were editing it. It has been reloaded; try again.",
    price_too_low: "The price cannot be below the starting price.",
    price_mismatch: "The price must match the published website service price.",
    quote_required: "Add the scope of work and the final price first.",
    not_found: "This request no longer exists.",
  } as Record<string, string>,
};
type Copy = typeof en;
const fr: Copy = {
  title: "Demandes de site Web",
  intro:
    "Demandes de site Web clé en main des clients et visiteurs. L’examen vient en premier : une demande doit être examinée avant d’être approuvée, et demander un paiement ne fait que le consigner. Personne n’est jamais facturé depuis cette page.",
  search: "Rechercher une entreprise, un contact ou un courriel",
  status: "Statut",
  payment: "Paiement",
  all: "Tous",
  customer: "Client",
  services: "Services",
  submitted: "Soumise",
  price: "Prix",
  review: "Examiner",
  hide: "Fermer",
  caption: "Demandes de site Web",
  empty: "Aucune demande de site Web ne correspond à ces filtres.",
  loadError: "Les demandes de site Web n’ont pas pu être chargées.",
  statuses: {
    submitted: "En attente", in_review: "En examen", approved: "Approuvée", quoted: "Soumission envoyée",
    in_progress: "En cours", delivered: "Terminée", rejected: "Refusée", cancelled: "Annulée",
  },
  payments: { not_requested: "Non demandé", requested: "Demandé", paid: "Payé", waived: "Exonéré" },
  paymentVerbs: { not_requested: "Retirer la demande de paiement", requested: "Demander le paiement", paid: "Marquer comme payé", waived: "Exonérer le paiement" },
  focus: {
    mobile: "Adapté au mobile", contact_form: "Formulaire de contact", lead_capture: "Capture de prospects",
    tradecatch: "Lien avec TradeCatch", design: "Conception", content: "Contenu",
  },
  types: { new: "Nouveau site", improve: "Améliorer l’existant" },
  verbs: {
    startReview: "Commencer l’examen", backToReview: "Retour à l’examen", approved: "Approuver", quoted: "Envoyer la soumission",
    in_progress: "Commencer le travail", delivered: "Marquer comme terminée", rejected: "Refuser", cancelled: "Annuler la demande",
  },
  contact: "Contact",
  phone: "Téléphone",
  website: "Site actuel",
  notes: "Notes du client",
  teamEmail: "Courriel à l’équipe",
  notifications: { sent: "Envoyé", not_configured: "Non configuré", failed: "Échec" },
  notificationsNone: "Non consigné",
  scope: "Portée des travaux",
  scopeHint: "Ce qui sera réalisé. Requis avant d’envoyer une soumission ou de commencer le travail.",
  finalPrice: "Prix final (CAD)",
  priceHint: "Laissez vide pour utiliser le prix publié du service de site Web.",
  reviewNote: "Note interne",
  reviewNoteHint: "Seule l’équipe la voit. Requise pour refuser.",
  saveDetails: "Enregistrer la portée, le prix et la note",
  saving: "Enregistrement…",
  nextSteps: "Faire avancer cette demande",
  paymentTitle: "Paiement",
  paymentNote: "TradeCatch consigne le paiement ici. Il ne facture jamais le client : le paiement est perçu séparément, puis marqué comme payé.",
  noPaymentSteps: "Aucune étape de paiement disponible.",
  paymentNeedsApproval: "Le paiement peut être demandé une fois la demande approuvée ou soumissionnée et dotée d’un prix.",
  history: "Historique",
  historyEmpty: "Aucun historique pour l’instant.",
  readOnly: "Votre rôle permet de lire les demandes de site Web, pas de les modifier.",
  rejectTitle: "Refuser cette demande?",
  rejectBody: "C’est définitif. Le client reçoit par courriel le motif ci-dessous; la note interne reste à l’équipe.",
  customerReason: "Motif envoyé au client",
  customerReasonHint: "Rédigé pour le client : il le reçoit par courriel. 5 caractères minimum.",
  approveBody: "Le client reçoit un courriel confirmant l’approbation, avec les prochaines étapes.",
  customerEmail: {
    sent: "Le client a reçu un courriel.",
    already_sent: "Le client avait déjà reçu un courriel pour cette décision.",
    failed: "Le courriel au client n’a pas pu être envoyé. Communiquez avec lui directement.",
    not_configured: "Le courriel n’est pas configuré sur ce serveur : le client n’a pas été avisé.",
  } as Record<string, string>,
  customerEmailEvent: "Courriel au client ({status}) : {result}",
  customerEmailResults: { sent: "envoyé", failed: "échec", not_configured: "non configuré", already_sent: "déjà envoyé" } as Record<string, string>,
  cancelTitle: "Annuler cette demande?",
  cancelBody: "C’est définitif. Toute demande de paiement en attente est retirée.",
  moveTitle: "Passer à « {status} »?",
  paymentConfirmTitle: "{verb}?",
  requestedBody: "Consigne que le paiement est demandé. TradeCatch ne facture pas le client.",
  paidBody: "Consigne que vous avez reçu le paiement. Cette action ne facture rien.",
  waivedBody: "Consigne qu’aucun paiement n’est nécessaire pour cette demande.",
  withdrawBody: "Consigne que la demande de paiement a été retirée.",
  confirm: "Confirmer",
  saved: "Enregistré.",
  event: {
    submitted: "Demande soumise",
    notified: "Courriel à l’équipe : {note}",
    status_changed: "Statut : {from} → {to}",
    quote_updated: "Soumission mise à jour : {note}",
    payment_updated: "Paiement : {note}",
    note: "Note : {note}",
  },
  errors: {
    invalid_transition: "Ce changement de statut n’est pas permis depuis le statut actuel.",
    invalid_payment_transition: "Ce changement de paiement n’est pas permis depuis le statut de paiement actuel.",
    payment_not_allowed: "Le paiement ne peut être demandé qu’une fois le travail approuvé ou soumissionné.",
    review_note_required: "Ajoutez le motif dans la note interne avant de refuser.",
    customer_reason_required: "Rédigez le motif que recevra le client (5 caractères minimum).",
    locked: "La portée et le prix convenus ne peuvent plus être modifiés une fois le travail commencé.",
    conflict: "Cette demande a changé pendant votre modification. Elle a été rechargée; réessayez.",
    price_too_low: "Le prix ne peut pas être inférieur au prix de départ.",
    price_mismatch: "Le prix doit correspondre au prix publié du service de site Web.",
    quote_required: "Ajoutez d’abord la portée des travaux et le prix final.",
    not_found: "Cette demande n’existe plus.",
  },
};

const STATUS_TONE: Record<WebsiteRequestStatus, Tone> = {
  submitted: "info",
  in_review: "warn",
  approved: "good",
  quoted: "info",
  in_progress: "info",
  delivered: "good",
  rejected: "bad",
  cancelled: "neutral",
};
const PAYMENT_TONE: Record<WebsitePaymentStatus, Tone> = {
  not_requested: "neutral",
  requested: "warn",
  paid: "good",
  waived: "neutral",
};
const NOTIFY_TONE: Record<string, Tone> = { sent: "good", not_configured: "warn", failed: "bad" };

type ListResponse = {
  ok: true;
  requests: WebsiteRequest[];
  total: number;
  page: number;
  pages: number;
  statusCounts: Record<string, number>;
};
type DetailResponse = { ok: true; request: WebsiteRequest; history: WebsiteRequestEvent[] };

const safeUrl = (value: string | null) => (value && /^https?:\/\//i.test(value) ? value : null);

type Step =
  | { kind: "status"; to: WebsiteRequestStatus }
  | { kind: "payment"; to: WebsitePaymentStatus };

function RequestDetail({
  id,
  onChanged,
}: {
  id: string;
  onChanged: () => void;
}) {
  const locale = useLocaleTag();
  const t: Copy = locale === "fr" ? fr : en;
  const loadError = useLoadErrorText();
  const { can, known } = useAdminPermissions();
  const { data, error, loading, refresh } = useAdminData<DetailResponse>(`/api/admin/website-requests/${encodeURIComponent(id)}`);
  const action = useAdminAction();
  const [step, setStep] = useState<Step | null>(null);
  const [saved, setSaved] = useState(false);
  const request = data?.request;
  const writable = known && can("website.write");

  return (
    <DataState loading={loading} error={error} hasData={Boolean(request)} onRetry={refresh} errorText={error?.status === 404 ? t.errors.not_found : loadError(error, t.loadError)}>
      {request && data ? (
        <DetailBody
          key={`${request.updatedAt}:${request.statusChangedAt}`}
          request={request}
          history={data.history}
          writable={writable}
          known={known}
          step={step}
          setStep={setStep}
          saved={saved}
          setSaved={setSaved}
          action={action}
          onSaved={() => {
            refresh();
            onChanged();
          }}
        />
      ) : null}
    </DataState>
  );
}

function DetailBody({
  request,
  history,
  writable,
  known,
  step,
  setStep,
  saved,
  setSaved,
  action,
  onSaved,
}: {
  request: WebsiteRequest;
  history: WebsiteRequestEvent[];
  writable: boolean;
  known: boolean;
  step: Step | null;
  setStep: (step: Step | null) => void;
  saved: boolean;
  setSaved: (saved: boolean) => void;
  action: ReturnType<typeof useAdminAction>;
  onSaved: () => void;
}) {
  const locale = useLocaleTag();
  const t: Copy = locale === "fr" ? fr : en;
  const errorText = useErrorText();
  const [scope, setScope] = useState(request.scopeSummary ?? "");
  const [price, setPrice] = useState(request.quotedPriceCad != null ? String(request.quotedPriceCad) : "");
  const [note, setNote] = useState(request.reviewNote ?? "");
  const [noteMissing, setNoteMissing] = useState(false);
  const [customerReason, setCustomerReason] = useState("");
  const [reasonMissing, setReasonMissing] = useState(false);
  const [customerEmail, setCustomerEmail] = useState<string | null>(null);

  const nextStatuses = WEBSITE_REQUEST_STATUSES.filter(
    (status) => status !== request.status && canTransitionWebsiteStatus(request.status, status),
  );
  const nextPayments = WEBSITE_PAYMENT_STATUSES.filter(
    (status) => status !== request.paymentStatus && canTransitionWebsitePayment(request.paymentStatus, status),
  );

  const verbFor = (to: WebsiteRequestStatus) =>
    to === "in_review"
      ? request.status === "submitted"
        ? t.verbs.startReview
        : t.verbs.backToReview
      : (t.verbs[to] ?? t.statuses[to]);

  const parsedPrice = price.trim() === "" ? undefined : Number(price);
  const priceInvalid = parsedPrice !== undefined && !Number.isFinite(parsedPrice);
  // The server enforces this; the page says it up front instead of offering a step that must fail.
  const canRequestPayment =
    PAYMENT_REQUEST_STATUSES.includes(request.status) && parsedPrice !== undefined && !priceInvalid;

  function detailsPatch() {
    const patch: Record<string, unknown> = {};
    if (scope !== (request.scopeSummary ?? "")) patch.scopeSummary = scope.trim() || null;
    if (parsedPrice !== undefined && parsedPrice !== request.quotedPriceCad) patch.quotedPriceCad = parsedPrice;
    if (price.trim() === "" && request.quotedPriceCad != null) patch.quotedPriceCad = null;
    if (note !== (request.reviewNote ?? "")) patch.reviewNote = note.trim() || null;
    return patch;
  }

  async function send(patch: Record<string, unknown>) {
    setSaved(false);
    setCustomerEmail(null);
    const result = await action.run(() =>
      adminFetch(`/api/admin/website-requests/${encodeURIComponent(request.id)}`, { method: "PATCH", body: patch }),
    );
    if (result) {
      setStep(null);
      setSaved(true);
      setCustomerReason("");
      const emailed = (result as { customerEmail?: string }).customerEmail;
      if (emailed) setCustomerEmail(emailed);
      onSaved();
    } else {
      // A conflict means someone else changed it: show them the current state.
      onSaved();
    }
  }

  const patchDirty = Object.keys(detailsPatch()).length > 0;
  const failure = action.error ? errorText(action.error, t.errors) : undefined;

  function confirmCopy(next: Step): { title: string; body: string; danger: boolean } {
    if (next.kind === "status") {
      if (next.to === "rejected") return { title: t.rejectTitle, body: t.rejectBody, danger: true };
      if (next.to === "approved") return { title: t.moveTitle.replace("{status}", t.statuses[next.to]), body: t.approveBody, danger: false };
      if (next.to === "cancelled") return { title: t.cancelTitle, body: t.cancelBody, danger: true };
      return { title: t.moveTitle.replace("{status}", t.statuses[next.to]), body: "", danger: false };
    }
    const body = {
      requested: t.requestedBody, paid: t.paidBody, waived: t.waivedBody, not_requested: t.withdrawBody,
    }[next.to];
    return { title: t.paymentConfirmTitle.replace("{verb}", t.paymentVerbs[next.to]), body, danger: false };
  }

  function run(next: Step) {
    if (next.kind === "status" && next.to === "rejected" && note.trim() === "") {
      // The reason is the point of a rejection: say so here instead of sending a request that must fail.
      setNoteMissing(true);
      return;
    }
    if (next.kind === "status" && next.to === "rejected" && customerReason.trim().length < 5) {
      setReasonMissing(true);
      return;
    }
    // Scope, price and note travel with the step so a quote and its status change are one update.
    const patch: Record<string, unknown> = detailsPatch();
    if (next.kind === "status") patch.status = next.to;
    else patch.paymentStatus = next.to;
    if (next.kind === "status" && next.to === "rejected") patch.customerReason = customerReason.trim();
    void send(patch);
  }

  const website = safeUrl(request.currentWebsiteUrl);

  return (
    <div className="flex flex-col gap-4 text-sm">
      {known && !writable ? <Notice tone="neutral">{t.readOnly}</Notice> : null}
      {saved ? <Notice tone="good" onClose={() => setSaved(false)}>{t.saved}</Notice> : null}
      {customerEmail ? (
        <Notice tone={customerEmail === "sent" || customerEmail === "already_sent" ? "good" : "bad"} onClose={() => setCustomerEmail(null)}>
          {t.customerEmail[customerEmail] ?? customerEmail}
        </Notice>
      ) : null}

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <div>
          <dt className="text-navy/70">{t.contact}</dt>
          <dd className="break-words font-medium text-navy">
            {request.contactName} ·{" "}
            <a className="underline" href={`mailto:${request.contactEmail}`}>{request.contactEmail}</a>
          </dd>
        </div>
        <div>
          <dt className="text-navy/70">{t.phone}</dt>
          <dd className="font-medium text-navy">
            {request.contactPhone ? <a className="underline" href={`tel:${request.contactPhone}`}>{request.contactPhone}</a> : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-navy/70">{t.website}</dt>
          <dd className="break-all font-medium text-navy">
            {website ? <a className="underline" href={website} target="_blank" rel="noopener noreferrer">{website}</a> : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-navy/70">{t.teamEmail}</dt>
          <dd>
            {request.notificationStatus ? (
              <Badge tone={NOTIFY_TONE[request.notificationStatus] ?? "neutral"}>{t.notifications[request.notificationStatus] ?? request.notificationStatus}</Badge>
            ) : (
              <span className="text-navy/70">{t.notificationsNone}</span>
            )}
          </dd>
        </div>
        {request.notes ? (
          <div className="sm:col-span-2">
            <dt className="text-navy/70">{t.notes}</dt>
            <dd className="whitespace-pre-wrap break-words text-navy">{request.notes}</dd>
          </div>
        ) : null}
      </dl>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.scope} htmlFor={`scope-${request.id}`} hint={t.scopeHint}>
          <textarea id={`scope-${request.id}`} rows={3} maxLength={2000} value={scope} onChange={(e) => setScope(e.target.value)} className={inputClass} disabled={!writable || action.pending} />
        </Field>
        <div className="flex flex-col gap-3">
          <Field label={t.finalPrice} htmlFor={`price-${request.id}`} hint={t.priceHint} error={priceInvalid ? "?" : undefined}>
            <input id={`price-${request.id}`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} disabled={!writable || action.pending} />
          </Field>
          <Field label={t.reviewNote} htmlFor={`note-${request.id}`} hint={t.reviewNoteHint}>
            <textarea id={`note-${request.id}`} rows={2} maxLength={1000} value={note} onChange={(e) => { setNote(e.target.value); setNoteMissing(false); }} className={inputClass} disabled={!writable || action.pending} />
          </Field>
        </div>
      </div>
      {writable ? (
        <div>
          <button type="button" className={secondaryButton} disabled={!patchDirty || priceInvalid || action.pending} aria-busy={action.pending && !step} onClick={() => void send(detailsPatch())}>
            <BusyLabel pending={action.pending && !step} busyLabel={t.saving}>{t.saveDetails}</BusyLabel>
          </button>
        </div>
      ) : null}

      {writable && nextStatuses.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold text-navy">{t.nextSteps}</h3>
          <div className="flex flex-wrap gap-2">
            {nextStatuses.map((to) => (
              <button
                key={to}
                type="button"
                className={to === "rejected" || to === "cancelled" ? secondaryButton : primaryButton}
                disabled={action.pending}
                onClick={() => { action.reset(); setSaved(false); setNoteMissing(false); setStep({ kind: "status", to }); }}
              >
                {verbFor(to)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold text-navy">{t.paymentTitle}</h3>
        <p className="text-navy/80">
          <Badge tone={PAYMENT_TONE[request.paymentStatus]}>{t.payments[request.paymentStatus]}</Badge>{" "}
          {request.quotedPriceCad != null ? formatMoney(Math.round(request.quotedPriceCad * 100), "CAD", locale) : ""}
        </p>
        <p className="text-xs text-navy/70">{t.paymentNote}</p>
        {writable ? (
          nextPayments.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {nextPayments.map((to) => (
                <button
                  key={to}
                  type="button"
                  className={secondaryButton}
                  disabled={action.pending || (to === "requested" && !canRequestPayment)}
                  onClick={() => { action.reset(); setSaved(false); setStep({ kind: "payment", to }); }}
                >
                  {t.paymentVerbs[to]}
                </button>
              ))}
              {nextPayments.includes("requested") && !canRequestPayment ? (
                <p className="basis-full text-xs text-navy/70">{t.paymentNeedsApproval}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-navy/70">{t.noPaymentSteps}</p>
          )
        ) : null}
      </div>

      {step ? (
        <ConfirmPanel
          title={confirmCopy(step).title}
          description={
            step.kind === "status" && step.to === "rejected" ? (
              <div className="flex flex-col gap-3">
                <span>{confirmCopy(step).body}</span>
                <Field label={t.customerReason} htmlFor={`reason-${request.id}`} hint={t.customerReasonHint}>
                  <textarea id={`reason-${request.id}`} rows={3} maxLength={600} value={customerReason} onChange={(e) => { setCustomerReason(e.target.value); setReasonMissing(false); }} className={inputClass} disabled={action.pending} />
                </Field>
              </div>
            ) : (
              confirmCopy(step).body || undefined
            )
          }
          word={step.kind === "status" && step.to === "rejected" ? "reject" : step.kind === "status" && step.to === "cancelled" ? "cancel" : undefined}
          confirmLabel={t.confirm}
          tone={confirmCopy(step).danger ? "danger" : "primary"}
          busy={action.pending}
          error={noteMissing ? t.errors.review_note_required : reasonMissing ? t.errors.customer_reason_required : failure}
          onConfirm={() => run(step)}
          onCancel={() => { setStep(null); action.reset(); }}
        />
      ) : failure ? (
        <Notice tone="bad">{failure}</Notice>
      ) : null}

      <div>
        <h3 className="font-semibold text-navy">{t.history}</h3>
        {history.length === 0 ? (
          <p className="mt-1 text-navy/70">{t.historyEmpty}</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-2 border-l-2 border-navy/15 pl-3">
            {history.map((event) => {
              const customer = event.kind === "notified" ? /^Customer email (w+) [[^]]*]: (w+)$/.exec(event.note ?? "") : null;
              const template = customer
                ? t.customerEmailEvent
                    .replace("{status}", t.statuses[customer[1] as WebsiteRequestStatus] ?? customer[1]!)
                    .replace("{result}", t.customerEmailResults[customer[2]!] ?? customer[2]!)
                : (t.event[event.kind] ?? event.kind);
              const label = template
                .replace("{from}", event.fromStatus ? (t.statuses[event.fromStatus] ?? event.fromStatus) : "—")
                .replace("{to}", event.toStatus ? (t.statuses[event.toStatus] ?? event.toStatus) : "—")
                .replace("{note}", event.kind === "notified" ? (t.notifications[event.note ?? ""] ?? event.note ?? "") : (event.note ?? ""));
              return (
                <li key={event.id} className="text-navy">
                  <p className="break-words">{label}</p>
                  <p className="text-xs text-navy/70">
                    {formatDateTime(event.createdAt, locale)}
                    {event.actor ? ` · ${event.actor}` : ""}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

export function WebsiteRequestsConsole() {
  const locale = useLocaleTag();
  const t: Copy = locale === "fr" ? fr : en;
  const common = useCommon();
  const loadError = useLoadErrorText();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const debouncedQ = useDebounced(q);

  const url = `/api/admin/website-requests${queryString({ q: debouncedQ.trim(), status, paymentStatus, businessId, from, to, page, pageSize: 20 })}`;
  const { data, error, loading, refresh, updatedAt } = useAdminData<ListResponse>(url);

  const reset = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(1);
    setOpen(null);
  };

  const columns: Column<WebsiteRequest>[] = [
    {
      id: "customer",
      header: t.customer,
      primary: true,
      cell: (row) => (
        <>
          <span className="font-semibold text-navy">{row.businessName}</span>
          <span className="block text-xs font-normal text-navy/70">{row.contactName}</span>
          <span className="block break-all text-xs font-normal text-navy/70">{row.contactEmail}</span>
          {row.organizationId ? (
            <Link href={{ pathname: "/admin/businesses/[id]", params: { id: row.organizationId } }} className="text-xs font-normal underline">
              {common.view}
            </Link>
          ) : null}
        </>
      ),
    },
    {
      id: "services",
      header: t.services,
      cell: (row) => (
        <>
          <span className="block">{t.types[row.requestType] ?? row.requestType}</span>
          {row.focusAreas.length ? (
            <span className="block text-xs text-navy/70">{row.focusAreas.map((area) => t.focus[area] ?? area).join(", ")}</span>
          ) : null}
        </>
      ),
    },
    { id: "submitted", header: t.submitted, cell: (row) => formatDate(row.createdAt, locale) },
    { id: "status", header: t.status, cell: (row) => <Badge tone={STATUS_TONE[row.status]}>{t.statuses[row.status] ?? row.status}</Badge> },
    { id: "payment", header: t.payment, cell: (row) => <Badge tone={PAYMENT_TONE[row.paymentStatus]}>{t.payments[row.paymentStatus]}</Badge> },
    { id: "price", header: t.price, cell: (row) => (row.quotedPriceCad != null ? formatMoney(Math.round(row.quotedPriceCad * 100), "CAD", locale) : "—") },
    {
      id: "review",
      header: "",
      cell: (row) => (
        <button
          type="button"
          className={secondaryButton}
          aria-expanded={open === row.id}
          onClick={() => setOpen((current) => (current === row.id ? null : row.id))}
        >
          {open === row.id ? t.hide : t.review}
        </button>
      ),
    },
  ];

  const totalAll = data ? Object.values(data.statusCounts).reduce((sum, n) => sum + n, 0) : 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.title} intro={t.intro} onRefresh={refresh} loading={loading} updatedAt={updatedAt} />

      <div className="flex flex-wrap gap-2" role="group" aria-label={t.status}>
        {["", ...WEBSITE_REQUEST_STATUSES].map((value) => {
          const active = status === value;
          const count = value === "" ? totalAll : (data?.statusCounts[value] ?? 0);
          return (
            <button
              key={value || "all"}
              type="button"
              aria-pressed={active}
              onClick={() => reset(setStatus)(value)}
              className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 ${
                active ? "border-navy bg-navy text-white" : "border-navy/25 bg-white text-navy hover:bg-navy/5"
              }`}
            >
              {value === "" ? t.all : t.statuses[value]}
              <span className={`rounded-full px-1.5 text-xs ${active ? "bg-white/20" : "bg-navy/10"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      <FilterBar>
        <Field label={common.search} htmlFor="wf-q">
          <input id="wf-q" type="search" value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder={t.search} className={inputClass} />
        </Field>
        <Field label={t.payment} htmlFor="wf-payment">
          <select id="wf-payment" value={paymentStatus} onChange={(e) => reset(setPaymentStatus)(e.target.value)} className={inputClass}>
            <option value="">{t.all}</option>
            {WEBSITE_PAYMENT_STATUSES.map((value) => (
              <option key={value} value={value}>{t.payments[value]}</option>
            ))}
          </select>
        </Field>
        <BusinessSelect id="wf-business" label={common.allBusinesses} value={businessId} onChange={reset(setBusinessId)} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={common.from} htmlFor="wf-from">
            <input id="wf-from" type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} className={inputClass} />
          </Field>
          <Field label={common.to} htmlFor="wf-to">
            <input id="wf-to" type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} className={inputClass} />
          </Field>
        </div>
      </FilterBar>

      <DataState
        loading={loading}
        error={error}
        hasData={Boolean(data)}
        empty={data?.requests.length === 0}
        onRetry={refresh}
        errorText={loadError(error, t.loadError)}
      >
        {data ? (
          <div className={card + " flex flex-col gap-3 !p-3"}>
            <DataTable
              columns={columns}
              rows={data.requests}
              rowKey={(row) => row.id}
              caption={t.caption}
              expanded={(row) => (open === row.id ? <RequestDetail id={row.id} onChanged={refresh} /> : null)}
            />
            <Pager page={data.page} pages={data.pages} total={data.total} onPage={(next) => { setPage(next); setOpen(null); }} busy={loading} />
          </div>
        ) : null}
      </DataState>
    </div>
  );
}
