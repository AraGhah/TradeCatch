"use client";

import { useState, type FormEvent } from "react";
import { Link } from "@/i18n/navigation";
import type { BusinessPage, BusinessSummary } from "@/product/admin-console/businesses";
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
  DataState,
  DataTable,
  Field,
  FilterBar,
  Notice,
  PageHeader,
  Pager,
  formatDate,
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
  title: "Businesses",
  intro:
    "Every customer account. Sign-in is by an emailed link or a password the owner chooses; administrators never see or set a password. Public registration is closed, so accounts are created here.",
  search: "Search name, city or owner email",
  status: "Status",
  plan: "Plan",
  type: "Account type",
  created: "Created",
  business: "Business",
  owner: "Owner",
  subscription: "Subscription",
  active: "Active",
  suspended: "Suspended",
  churned: "Deactivated",
  essential: "Essential",
  professional: "Professional",
  legacy: "earlier plan",
  starter: "Starter",
  growth: "Growth",
  receptionist: "Receptionist Plus",
  production: "Customer",
  pilot: "Pilot",
  demo: "Demo",
  noSubscription: "No subscription",
  cancelling: "ends {date}",
  caption: "Businesses",
  create: "Create customer account",
  createTitle: "New customer account",
  createIntro:
    "Creates the business and its owner. The owner receives a single-use link to choose their own password; until they do, no one can sign in as them.",
  orgName: "Business name",
  ownerName: "Owner name",
  ownerEmail: "Owner email",
  language: "Language",
  english: "English",
  french: "French",
  phone: "Business phone (optional)",
  city: "City (optional)",
  industry: "Industry (optional)",
  invite: "Email the owner an invitation to set their password",
  submit: "Create account",
  creating: "Creating…",
  fieldBad: "Check this field.",
  created_ok: "Created {name}.",
  openIt: "Open the business",
  inviteSent: "An invitation was emailed to the owner.",
  inviteFailed: "The account exists, but the invitation email could not be sent. Open the business to follow up.",
  inviteOff: "No invitation was sent.",
  loadError: "Businesses could not be loaded.",
  noAccess: "Your role cannot create accounts.",
  emailExists: "That email already belongs to a business. Open that business instead.",
  createFailed: "The account could not be created. Nothing was saved.",
};
type Copy = typeof en;
const fr: Copy = {
  title: "Entreprises",
  intro:
    "Tous les comptes clients. La connexion se fait par lien envoyé par courriel ou par un mot de passe choisi par le propriétaire; les administrateurs ne voient ni ne définissent jamais de mot de passe. L’inscription publique est fermée : les comptes se créent ici.",
  search: "Rechercher par nom, ville ou courriel du propriétaire",
  status: "Statut",
  plan: "Forfait",
  type: "Type de compte",
  created: "Créé",
  business: "Entreprise",
  owner: "Propriétaire",
  subscription: "Abonnement",
  active: "Actif",
  suspended: "Suspendu",
  churned: "Désactivé",
  essential: "Essentiel",
  professional: "Professionnel",
  legacy: "ancien forfait",
  starter: "Démarrage",
  growth: "Croissance",
  receptionist: "Réceptionniste Plus",
  production: "Client",
  pilot: "Pilote",
  demo: "Démo",
  noSubscription: "Aucun abonnement",
  cancelling: "se termine le {date}",
  caption: "Entreprises",
  create: "Créer un compte client",
  createTitle: "Nouveau compte client",
  createIntro:
    "Crée l’entreprise et son propriétaire. Le propriétaire reçoit un lien à usage unique pour choisir son mot de passe; d’ici là, personne ne peut se connecter en son nom.",
  orgName: "Nom de l’entreprise",
  ownerName: "Nom du propriétaire",
  ownerEmail: "Courriel du propriétaire",
  language: "Langue",
  english: "Anglais",
  french: "Français",
  phone: "Téléphone de l’entreprise (facultatif)",
  city: "Ville (facultatif)",
  industry: "Secteur (facultatif)",
  invite: "Envoyer au propriétaire une invitation pour définir son mot de passe",
  submit: "Créer le compte",
  creating: "Création…",
  fieldBad: "Vérifiez ce champ.",
  created_ok: "{name} a été créé.",
  openIt: "Ouvrir l’entreprise",
  inviteSent: "Une invitation a été envoyée au propriétaire par courriel.",
  inviteFailed: "Le compte existe, mais le courriel d’invitation n’a pas pu être envoyé. Ouvrez l’entreprise pour faire le suivi.",
  inviteOff: "Aucune invitation n’a été envoyée.",
  loadError: "Les entreprises n’ont pas pu être chargées.",
  noAccess: "Votre rôle ne permet pas de créer des comptes.",
  emailExists: "Ce courriel appartient déjà à une entreprise. Ouvrez plutôt cette entreprise.",
  createFailed: "Le compte n’a pas pu être créé. Rien n’a été enregistré.",
};

export const ORG_STATUS_TONE: Record<string, Tone> = {
  active: "good",
  suspended: "warn",
  churned: "bad",
};

export const SUBSCRIPTION_TONE: Record<string, Tone> = {
  active: "good",
  trialing: "info",
  past_due: "bad",
  unpaid: "bad",
  canceled: "neutral",
  incomplete: "warn",
  incomplete_expired: "neutral",
  paused: "warn",
};

type CreateResponse = {
  ok: true;
  id: string;
  name: string;
  invite: { requested: boolean; sent: boolean };
};

const EMPTY_FORM = {
  organizationName: "",
  ownerName: "",
  ownerEmail: "",
  plan: "essential",
  locale: "en",
  phone: "",
  city: "",
  industry: "",
  sendInvite: true,
};

export function BusinessesConsole() {
  const locale = useLocaleTag();
  const t: Copy = locale === "fr" ? fr : en;
  const common = useCommon();
  const errorText = useErrorText();
  const loadError = useLoadErrorText();
  const { can, known } = useAdminPermissions();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState("");
  const [accountType, setAccountType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const debouncedQ = useDebounced(q);

  const url = `/api/admin/businesses${queryString({
    q: debouncedQ.trim(),
    status,
    plan,
    accountType,
    from,
    to,
    page,
    pageSize: 20,
  })}`;
  const { data, error, loading, refresh, updatedAt } = useAdminData<BusinessPage & { ok: true }>(url);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [created, setCreated] = useState<CreateResponse | null>(null);
  const action = useAdminAction();

  const statusLabel: Record<string, string> = { active: t.active, suspended: t.suspended, churned: t.churned };
  const planLabel: Record<string, string> = {
    essential: t.essential,
    professional: t.professional,
    starter: `${t.starter} (${t.legacy})`,
    growth: `${t.growth} (${t.legacy})`,
    receptionist: `${t.receptionist} (${t.legacy})`,
  };
  const typeLabel: Record<string, string> = { production: t.production, pilot: t.pilot, demo: t.demo };

  function resetPaging<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setPage(1);
    };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFieldErrors([]);
    setCreated(null);
    const result = await action.run(
      () =>
      adminFetch<CreateResponse>("/api/admin/businesses", {
        method: "POST",
        body: {
          organizationName: form.organizationName,
          ownerName: form.ownerName,
          ownerEmail: form.ownerEmail,
          plan: form.plan,
          locale: form.locale,
          phone: form.phone.trim() || null,
          city: form.city.trim() || undefined,
          industry: form.industry.trim() || undefined,
          sendInvite: form.sendInvite,
        },
      }),
      (failure) => setFieldErrors(failure.fields),
    );
    if (result) {
      setCreated(result);
      setForm(EMPTY_FORM);
      setCreating(false);
      setPage(1);
      refresh();
    }
  }

  const fieldError = (name: string) => (fieldErrors.includes(name) ? t.fieldBad : undefined);
  const set = <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const columns: Column<BusinessSummary>[] = [
    {
      id: "business",
      header: t.business,
      primary: true,
      cell: (row) => (
        <>
          <Link
            href={{ pathname: "/admin/businesses/[id]", params: { id: row.id } }}
            className="font-semibold text-navy underline"
          >
            {row.name}
          </Link>
          {row.city ? <span className="block text-xs font-normal text-navy/70">{row.city}</span> : null}
        </>
      ),
    },
    {
      id: "owner",
      header: t.owner,
      cell: (row) =>
        row.owner ? (
          <>
            <span className="block">{row.owner.name}</span>
            <span className="block break-all text-xs text-navy/70">{row.owner.email}</span>
          </>
        ) : (
          "—"
        ),
    },
    { id: "plan", header: t.plan, cell: (row) => planLabel[row.plan] ?? row.plan },
    {
      id: "status",
      header: t.status,
      cell: (row) => <Badge tone={ORG_STATUS_TONE[row.status] ?? "neutral"}>{statusLabel[row.status] ?? row.status}</Badge>,
    },
    {
      id: "subscription",
      header: t.subscription,
      cell: (row) =>
        row.subscription ? (
          <>
            <Badge tone={SUBSCRIPTION_TONE[row.subscription.status] ?? "neutral"}>{row.subscription.status}</Badge>
            {row.subscription.cancelAtPeriodEnd ? (
              <span className="mt-1 block text-xs text-navy/70">
                {t.cancelling.replace("{date}", formatDate(row.subscription.currentPeriodEnd, locale))}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-navy/70">{t.noSubscription}</span>
        ),
    },
    { id: "created", header: t.created, cell: (row) => formatDate(row.createdAt, locale) },
  ];

  const createError = action.error
    ? errorText(action.error, { email_exists: t.emailExists, default: t.createFailed })
    : "";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.title}
        intro={t.intro}
        onRefresh={refresh}
        loading={loading}
        updatedAt={updatedAt}
        actions={
          <button
            type="button"
            className={primaryButton}
            aria-expanded={creating}
            disabled={!known || !can("business.create")}
            onClick={() => {
              setCreating((open) => !open);
              action.reset();
              setFieldErrors([]);
            }}
          >
            {t.create}
          </button>
        }
      />

      {known && !can("business.create") ? <Notice tone="neutral">{t.noAccess}</Notice> : null}

      {created ? (
        <Notice tone={created.invite.requested && !created.invite.sent ? "warn" : "good"} onClose={() => setCreated(null)}>
          <p className="font-semibold">{t.created_ok.replace("{name}", created.name)}</p>
          <p>
            {created.invite.requested ? (created.invite.sent ? t.inviteSent : t.inviteFailed) : t.inviteOff}{" "}
            <Link
              href={{ pathname: "/admin/businesses/[id]", params: { id: created.id } }}
              className="font-semibold underline"
            >
              {t.openIt}
            </Link>
          </p>
        </Notice>
      ) : null}

      {creating ? (
        <form
          onSubmit={(event) => void submit(event)}
          aria-labelledby="create-business-title"
          className="flex flex-col gap-4 rounded-md border border-navy/15 bg-white p-4"
        >
          <div>
            <h2 id="create-business-title" className="font-semibold text-navy">{t.createTitle}</h2>
            <p className="mt-1 text-sm text-navy/70">{t.createIntro}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.orgName} htmlFor="cb-org" error={fieldError("organizationName")}>
              <input id="cb-org" required minLength={2} maxLength={120} value={form.organizationName} onChange={(e) => set("organizationName", e.target.value)} className={inputClass} disabled={action.pending} />
            </Field>
            <Field label={t.ownerName} htmlFor="cb-owner" error={fieldError("ownerName")}>
              <input id="cb-owner" required maxLength={120} value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} className={inputClass} disabled={action.pending} autoComplete="off" />
            </Field>
            <Field label={t.ownerEmail} htmlFor="cb-email" error={fieldError("ownerEmail")}>
              <input id="cb-email" type="email" required maxLength={200} value={form.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} className={inputClass} disabled={action.pending} autoComplete="off" />
            </Field>
            <Field label={t.plan} htmlFor="cb-plan" error={fieldError("plan")}>
              <select id="cb-plan" value={form.plan} onChange={(e) => set("plan", e.target.value)} className={inputClass} disabled={action.pending}>
                <option value="essential">{t.essential}</option>
                <option value="professional">{t.professional}</option>
              </select>
            </Field>
            <Field label={t.language} htmlFor="cb-locale">
              <select id="cb-locale" value={form.locale} onChange={(e) => set("locale", e.target.value)} className={inputClass} disabled={action.pending}>
                <option value="en">{t.english}</option>
                <option value="fr">{t.french}</option>
              </select>
            </Field>
            <Field label={t.phone} htmlFor="cb-phone" error={fieldError("phone")}>
              <input id="cb-phone" type="tel" maxLength={30} value={form.phone} onChange={(e) => set("phone", e.target.value)} className={inputClass} disabled={action.pending} />
            </Field>
            <Field label={t.city} htmlFor="cb-city" error={fieldError("city")}>
              <input id="cb-city" maxLength={80} value={form.city} onChange={(e) => set("city", e.target.value)} className={inputClass} disabled={action.pending} />
            </Field>
            <Field label={t.industry} htmlFor="cb-industry" error={fieldError("industry")}>
              <input id="cb-industry" maxLength={80} value={form.industry} onChange={(e) => set("industry", e.target.value)} className={inputClass} disabled={action.pending} />
            </Field>
          </div>
          <label className="flex items-start gap-2 text-sm text-navy">
            <input type="checkbox" checked={form.sendInvite} onChange={(e) => set("sendInvite", e.target.checked)} disabled={action.pending} className="mt-1 h-4 w-4" />
            {t.invite}
          </label>
          {createError ? <Notice tone="bad">{createError}</Notice> : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primaryButton} disabled={action.pending}>
              {action.pending ? t.creating : t.submit}
            </button>
            <button type="button" className={secondaryButton} disabled={action.pending} onClick={() => setCreating(false)}>
              {common.cancel}
            </button>
          </div>
        </form>
      ) : null}

      <FilterBar>
        <Field label={common.search} htmlFor="bf-q">
          <input id="bf-q" type="search" value={q} onChange={(e) => resetPaging(setQ)(e.target.value)} placeholder={t.search} className={inputClass} />
        </Field>
        <Field label={t.status} htmlFor="bf-status">
          <select id="bf-status" value={status} onChange={(e) => resetPaging(setStatus)(e.target.value)} className={inputClass}>
            <option value="">{common.all}</option>
            <option value="active">{t.active}</option>
            <option value="suspended">{t.suspended}</option>
            <option value="churned">{t.churned}</option>
          </select>
        </Field>
        <Field label={t.plan} htmlFor="bf-plan">
          <select id="bf-plan" value={plan} onChange={(e) => resetPaging(setPlan)(e.target.value)} className={inputClass}>
            <option value="">{common.all}</option>
            {Object.entries(planLabel).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label={t.type} htmlFor="bf-type">
          <select id="bf-type" value={accountType} onChange={(e) => resetPaging(setAccountType)(e.target.value)} className={inputClass}>
            <option value="">{common.all}</option>
            {Object.entries(typeLabel).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label={`${t.created} · ${common.from}`} htmlFor="bf-from">
          <input id="bf-from" type="date" value={from} onChange={(e) => resetPaging(setFrom)(e.target.value)} className={inputClass} />
        </Field>
        <Field label={`${t.created} · ${common.to}`} htmlFor="bf-to">
          <input id="bf-to" type="date" value={to} onChange={(e) => resetPaging(setTo)(e.target.value)} className={inputClass} />
        </Field>
      </FilterBar>

      <DataState
        loading={loading}
        error={error}
        hasData={Boolean(data)}
        empty={data?.rows.length === 0}
        onRetry={refresh}
        errorText={loadError(error, t.loadError)}
      >
        {data ? (
          <>
            <DataTable columns={columns} rows={data.rows} rowKey={(row) => row.id} caption={t.caption} />
            <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} busy={loading} />
          </>
        ) : null}
      </DataState>
    </div>
  );
}
