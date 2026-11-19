"use client";

import { useState, type FormEvent } from "react";
import { Link } from "@/i18n/navigation";
import type { BusinessDetail } from "@/product/admin-console/businesses";
import { adminFetch, useAdminAction, useAdminData, useAdminPermissions } from "./api";
import { ORG_STATUS_TONE } from "./BusinessesConsole";
import {
  Badge,
  DataState,
  Field,
  Notice,
  PageHeader,
  card,
  formatDate,
  inputClass,
  primaryButton,
  secondaryButton,
  useCommon,
  useErrorText,
  useLoadErrorText,
  useLocaleTag,
  type Tone,
} from "./ui";

const en = {
  title: "Business details",
  info: "Business information",
  infoIntro: "Corrections made here are recorded in the audit log with who changed what.",
  name: "Business name",
  industry: "Industry",
  city: "City",
  phone: "Business phone",
  phoneHint: "Saved in international format.",
  serviceArea: "Service area",
  timezone: "Time zone",
  language: "Default language",
  english: "English",
  french: "French",
  save: "Save changes",
  saving: "Saving…",
  reset: "Discard edits",
  saved: "Saved. The change is in the audit log.",
  noChange: "Nothing was changed.",
  fieldBad: "Check this field.",
  saveFailed: "The change could not be saved.",
  noAccess: "Your role can view this business but not change it.",
  planTitle: "Plan and billing",
  plan: "Plan",
  status: "Status",
  created: "Created",
  subscription: "Stripe subscription",
  none: "None recorded",
  seeSubs: "Open subscriptions",
  servicesTitle: "Services this plan includes",
  servicesIntro: "What the customer's plan entitles them to. “Not launched yet” means the plan includes it but it is switched off platform-wide.",
  included: "Included",
  notIncluded: "Not in this plan",
  notLaunched: "Not launched yet",
  receptionistTitle: "Receptionist",
  linked: "Phone line linked",
  notLinked: "No phone line is linked to this business yet.",
  activated: "Receptionist activated",
  notActivated: "Not activated",
  phoneNumber: "Number",
  unknown: "Unknown",
  integrationsTitle: "Integrations",
  connected: "Connected",
  not_connected: "Not connected",
  unavailable: "Could not be checked",
  integration: {
    phone_line: "Phone line",
    voice_receptionist: "Voice receptionist",
    calendar: "Calendar",
    gmail: "Gmail",
    billing: "Billing (Stripe)",
  } as Record<string, string>,
  members: "Members",
  loadError: "This business could not be loaded.",
  notFound: "This business does not exist.",
  orgStatus: { active: "Active", suspended: "Suspended", churned: "Deactivated" } as Record<string, string>,
};
type Copy = typeof en;
const fr: Copy = {
  title: "Détails de l’entreprise",
  info: "Renseignements sur l’entreprise",
  infoIntro: "Les corrections faites ici sont consignées au journal d’audit, avec l’auteur et le détail du changement.",
  name: "Nom de l’entreprise",
  industry: "Secteur",
  city: "Ville",
  phone: "Téléphone de l’entreprise",
  phoneHint: "Enregistré au format international.",
  serviceArea: "Zone de service",
  timezone: "Fuseau horaire",
  language: "Langue par défaut",
  english: "Anglais",
  french: "Français",
  save: "Enregistrer",
  saving: "Enregistrement…",
  reset: "Annuler les modifications",
  saved: "Enregistré. Le changement figure au journal d’audit.",
  noChange: "Aucun changement.",
  fieldBad: "Vérifiez ce champ.",
  saveFailed: "Le changement n’a pas pu être enregistré.",
  noAccess: "Votre rôle permet de consulter cette entreprise, pas de la modifier.",
  planTitle: "Forfait et facturation",
  plan: "Forfait",
  status: "Statut",
  created: "Créé",
  subscription: "Abonnement Stripe",
  none: "Aucun enregistré",
  seeSubs: "Ouvrir les abonnements",
  servicesTitle: "Services inclus dans le forfait",
  servicesIntro: "Ce à quoi le forfait du client donne droit. « Pas encore lancé » signifie que le forfait l’inclut, mais que la fonction est désactivée pour toute la plateforme.",
  included: "Inclus",
  notIncluded: "Non inclus au forfait",
  notLaunched: "Pas encore lancé",
  receptionistTitle: "Réceptionniste",
  linked: "Ligne téléphonique liée",
  notLinked: "Aucune ligne téléphonique n’est encore liée à cette entreprise.",
  activated: "Réceptionniste activée",
  notActivated: "Non activée",
  phoneNumber: "Numéro",
  unknown: "Inconnu",
  integrationsTitle: "Intégrations",
  connected: "Connectée",
  not_connected: "Non connectée",
  unavailable: "Vérification impossible",
  integration: {
    phone_line: "Ligne téléphonique",
    voice_receptionist: "Réceptionniste vocale",
    calendar: "Calendrier",
    gmail: "Gmail",
    billing: "Facturation (Stripe)",
  },
  members: "Membres",
  loadError: "Cette entreprise n’a pas pu être chargée.",
  notFound: "Cette entreprise n’existe pas.",
  orgStatus: { active: "Actif", suspended: "Suspendu", churned: "Désactivé" },
};

const ZONES = [
  "America/St_Johns",
  "America/Halifax",
  "America/Toronto",
  "America/Winnipeg",
  "America/Regina",
  "America/Edmonton",
  "America/Vancouver",
];

const INTEGRATION_TONE: Record<string, Tone> = {
  connected: "good",
  not_connected: "neutral",
  unavailable: "warn",
};

const humanize = (id: string) => {
  const text = id.replace(/[_-]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function EditForm({ business, onSaved }: { business: BusinessDetail; onSaved: () => void }) {
  const locale = useLocaleTag();
  const t: Copy = locale === "fr" ? fr : en;
  const errorText = useErrorText();
  const { can, known } = useAdminPermissions();
  const action = useAdminAction();
  const initial = {
    name: business.name,
    industry: business.industry ?? "",
    city: business.city ?? "",
    phone: business.phoneE164 ?? "",
    serviceArea: business.serviceArea,
    timezone: business.timezone,
    localeDefault: business.localeDefault,
  };
  const [form, setForm] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<"none" | null>(null);
  const writable = known && can("business.write");
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = <K extends keyof typeof initial>(key: K, value: (typeof initial)[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setMessage(null);
  };
  const fieldError = (name: string) => (fieldErrors.includes(name) ? t.fieldBad : undefined);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFieldErrors([]);
    setMessage(null);
    // Send only what changed, so an unrelated edit made elsewhere is never overwritten.
    const patch: Record<string, unknown> = {};
    if (form.name !== initial.name) patch.name = form.name;
    if (form.industry !== initial.industry) patch.industry = form.industry.trim() || null;
    if (form.city !== initial.city) patch.city = form.city.trim() || null;
    if (form.phone !== initial.phone) patch.phone = form.phone.trim() || null;
    if (form.serviceArea !== initial.serviceArea) patch.serviceArea = form.serviceArea;
    if (form.timezone !== initial.timezone) patch.timezone = form.timezone;
    if (form.localeDefault !== initial.localeDefault) patch.localeDefault = form.localeDefault;
    if (Object.keys(patch).length === 0) {
      setMessage("none");
      return;
    }
    const result = await action.run(
      () => adminFetch(`/api/admin/businesses/${encodeURIComponent(business.id)}`, { method: "PATCH", body: patch }),
      (failure) => setFieldErrors(failure.fields),
    );
    if (result) onSaved();
  }

  const zones = ZONES.includes(initial.timezone) ? ZONES : [initial.timezone, ...ZONES];

  return (
    <form onSubmit={(event) => void submit(event)} className={`${card} flex flex-col gap-4`} aria-labelledby="edit-business-title">
      <div>
        <h2 id="edit-business-title" className="font-semibold text-navy">{t.info}</h2>
        <p className="mt-1 text-sm text-navy/70">{t.infoIntro}</p>
      </div>
      {known && !writable ? <Notice tone="neutral">{t.noAccess}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.name} htmlFor="eb-name" error={fieldError("name")}>
          <input id="eb-name" required minLength={2} maxLength={120} value={form.name} onChange={(e) => set("name", e.target.value)} className={inputClass} disabled={!writable || action.pending} />
        </Field>
        <Field label={t.industry} htmlFor="eb-industry" error={fieldError("industry")}>
          <input id="eb-industry" maxLength={80} value={form.industry} onChange={(e) => set("industry", e.target.value)} className={inputClass} disabled={!writable || action.pending} />
        </Field>
        <Field label={t.city} htmlFor="eb-city" error={fieldError("city")}>
          <input id="eb-city" maxLength={80} value={form.city} onChange={(e) => set("city", e.target.value)} className={inputClass} disabled={!writable || action.pending} />
        </Field>
        <Field label={t.phone} htmlFor="eb-phone" hint={t.phoneHint} error={fieldError("phone")}>
          <input id="eb-phone" type="tel" maxLength={30} value={form.phone} onChange={(e) => set("phone", e.target.value)} className={inputClass} disabled={!writable || action.pending} />
        </Field>
        <Field label={t.serviceArea} htmlFor="eb-area" error={fieldError("serviceArea")}>
          <input id="eb-area" maxLength={300} value={form.serviceArea} onChange={(e) => set("serviceArea", e.target.value)} className={inputClass} disabled={!writable || action.pending} />
        </Field>
        <Field label={t.timezone} htmlFor="eb-zone" error={fieldError("timezone")}>
          <select id="eb-zone" value={form.timezone} onChange={(e) => set("timezone", e.target.value)} className={inputClass} disabled={!writable || action.pending}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>{zone.replace("_", " ")}</option>
            ))}
          </select>
        </Field>
        <Field label={t.language} htmlFor="eb-locale">
          <select id="eb-locale" value={form.localeDefault} onChange={(e) => set("localeDefault", e.target.value as "en" | "fr")} className={inputClass} disabled={!writable || action.pending}>
            <option value="en">{t.english}</option>
            <option value="fr">{t.french}</option>
          </select>
        </Field>
      </div>
      {action.error ? (
        <Notice tone="bad">{errorText(action.error, { no_change: t.noChange, default: t.saveFailed })}</Notice>
      ) : null}
      {message === "none" ? <Notice tone="neutral">{t.noChange}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primaryButton} disabled={!writable || !dirty || action.pending}>
          {action.pending ? t.saving : t.save}
        </button>
        <button type="button" className={secondaryButton} disabled={!dirty || action.pending} onClick={() => { setForm(initial); setFieldErrors([]); action.reset(); }}>
          {t.reset}
        </button>
      </div>
    </form>
  );
}

export function BusinessProfile({ organizationId }: { organizationId: string }) {
  const locale = useLocaleTag();
  const t: Copy = locale === "fr" ? fr : en;
  const loadError = useLoadErrorText();
  const { data, error, loading, refresh, updatedAt } = useAdminData<{ ok: true; business: BusinessDetail }>(
    `/api/admin/businesses/${encodeURIComponent(organizationId)}`,
  );
  const business = data?.business;
  const common = useCommon();
  // Kept here, not in the form: the form remounts with the fresh data after a save.
  const [saved, setSaved] = useState(false);

  return (
    <section className="flex flex-col gap-5" aria-label={t.title}>
      <PageHeader title={t.title} onRefresh={refresh} loading={loading} updatedAt={updatedAt} />
      <DataState
        loading={loading}
        error={error}
        hasData={Boolean(business)}
        onRetry={refresh}
        errorText={error?.status === 404 ? t.notFound : loadError(error, t.loadError)}
      >
        {business ? (
          <>
            <div className={card}>
              <h2 className="font-semibold text-navy">{t.planTitle}</h2>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div><dt className="text-navy/70">{t.plan}</dt><dd className="font-medium text-navy">{business.planLabel}</dd></div>
                <div>
                  <dt className="text-navy/70">{t.status}</dt>
                  <dd><Badge tone={ORG_STATUS_TONE[business.status] ?? "neutral"}>{t.orgStatus[business.status] ?? business.status}</Badge></dd>
                </div>
                <div><dt className="text-navy/70">{t.created}</dt><dd className="font-medium text-navy">{formatDate(business.createdAt, locale)}</dd></div>
                <div>
                  <dt className="text-navy/70">{t.subscription}</dt>
                  <dd className="font-medium text-navy">
                    {business.subscription ? (
                      <>
                        {business.subscription.status}
                        {business.subscription.currentPeriodEnd ? ` · ${formatDate(business.subscription.currentPeriodEnd, locale)}` : ""}
                      </>
                    ) : t.none}{" "}
                    <Link href="/admin/subscriptions" className="text-sm font-normal underline">{t.seeSubs}</Link>
                  </dd>
                </div>
              </dl>
            </div>

            {saved ? (
              <Notice tone="good" onClose={() => setSaved(false)}>{t.saved}</Notice>
            ) : null}
            <EditForm
              key={business.updatedAt}
              business={business}
              onSaved={() => {
                setSaved(true);
                refresh();
              }}
            />

            <div className={card}>
              <h2 className="font-semibold text-navy">{t.servicesTitle}</h2>
              <p className="mt-1 text-sm text-navy/70">{t.servicesIntro}</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {business.services.map((service) => (
                  <li key={service.feature} className="flex items-center justify-between gap-3 rounded-md border border-navy/10 px-3 py-2 text-sm">
                    <span className="min-w-0 break-words text-navy">{humanize(service.feature)}</span>
                    {service.included ? (
                      service.available ? <Badge tone="good">{t.included}</Badge> : <Badge tone="warn">{t.notLaunched}</Badge>
                    ) : (
                      <Badge tone="neutral">{t.notIncluded}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div className={card}>
              <h2 className="font-semibold text-navy">{t.receptionistTitle}</h2>
              {business.receptionist.linked ? (
                <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-navy/70">{t.linked}</dt><dd className="font-medium text-navy">{common.yes}</dd></div>
                  <div><dt className="text-navy/70">{t.phoneNumber}</dt><dd className="font-medium text-navy">{business.receptionist.phoneNumber ?? "—"}</dd></div>
                  <div>
                    <dt className="text-navy/70">{t.activated}</dt>
                    <dd>
                      {business.receptionist.activated === null ? <Badge tone="warn">{t.unknown}</Badge>
                        : business.receptionist.activated ? <Badge tone="good">{t.connected}</Badge>
                        : <Badge tone="neutral">{t.notActivated}</Badge>}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-2 text-sm text-navy/70">{t.notLinked}</p>
              )}
            </div>

            <div className={card}>
              <h2 className="font-semibold text-navy">{t.integrationsTitle}</h2>
              <ul className="mt-3 divide-y divide-navy/10">
                {business.integrations.map((integration) => (
                  <li key={integration.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="text-navy">
                      {t.integration[integration.key] ?? humanize(integration.key)}
                      {integration.detail ? <span className="ml-2 break-all text-xs text-navy/70">{integration.detail}</span> : null}
                    </span>
                    <Badge tone={INTEGRATION_TONE[integration.state] ?? "neutral"}>{t[integration.state]}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
      </DataState>
    </section>
  );
}
