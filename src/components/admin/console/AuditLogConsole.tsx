"use client";

import { useState } from "react";
import type { AuditEvent } from "@/product/security/store";
import { Link } from "@/i18n/navigation";
import { queryString, useAdminData, useAdminPermissions, useDebounced } from "./api";
import {
  Badge,
  BusinessSelect,
  DataState,
  DataTable,
  Field,
  FilterBar,
  Notice,
  PageHeader,
  Pager,
  formatDateTime,
  inputClass,
  secondaryButton,
  useCommon,
  useLoadErrorText,
  useLocaleTag,
  type Column,
  type Tone,
} from "./ui";

const en = {
  title: "Audit logs",
  intro:
    "Who did what, and when, for every sensitive administrator action, including refused attempts. Records cannot be edited or deleted from here or from the database. Contact details are masked, and passwords, keys, tokens and card details are never recorded.",
  search: "Search action, target, detail or administrator",
  action: "Action",
  outcome: "Outcome",
  anyOutcome: "Any outcome",
  outcomes: { success: "Succeeded", denied: "Refused", failed: "Failed" } as Record<string, string>,
  when: "When",
  who: "Administrator",
  what: "Action",
  target: "Target",
  business: "Business",
  changes: "Changes",
  details: "Details",
  hide: "Hide",
  show: "Show",
  changeLine: "{field}: {from} → {to}",
  added: "(empty)",
  removed: "(removed)",
  changedNoValue: "{field} changed (value not recorded)",
  noChanges: "No field changes were recorded.",
  platform: "Platform",
  system: "System",
  caption: "Audit log",
  empty: "No audit records match these filters.",
  loadError: "The audit log could not be loaded.",
  noAccess: "Your role does not include audit-log access.",
  suspicious: "Refused and failed attempts are highlighted: repeated refusals from one administrator may indicate misuse.",
  readOnly: "Read-only",
  clear: "Clear filters",
};
type Copy = typeof en;
const fr: Copy = {
  title: "Journaux d’audit",
  intro:
    "Qui a fait quoi, et quand, pour chaque action sensible d’un administrateur, y compris les tentatives refusées. Les enregistrements ne peuvent être ni modifiés ni supprimés, ni d’ici ni dans la base de données. Les coordonnées sont masquées, et les mots de passe, clés, jetons et données de carte ne sont jamais consignés.",
  search: "Rechercher une action, une cible, un détail ou un administrateur",
  action: "Action",
  outcome: "Résultat",
  anyOutcome: "Tout résultat",
  outcomes: { success: "Réussie", denied: "Refusée", failed: "Échouée" },
  when: "Date",
  who: "Administrateur",
  what: "Action",
  target: "Cible",
  business: "Entreprise",
  changes: "Changements",
  details: "Détails",
  hide: "Masquer",
  show: "Afficher",
  changeLine: "{field} : {from} → {to}",
  added: "(vide)",
  removed: "(retiré)",
  changedNoValue: "{field} modifié (valeur non consignée)",
  noChanges: "Aucun changement de champ n’a été consigné.",
  platform: "Plateforme",
  system: "Système",
  caption: "Journal d’audit",
  empty: "Aucun enregistrement d’audit ne correspond à ces filtres.",
  loadError: "Le journal d’audit n’a pas pu être chargé.",
  noAccess: "Votre rôle n’inclut pas l’accès au journal d’audit.",
  suspicious: "Les tentatives refusées ou échouées sont mises en évidence : des refus répétés d’un même administrateur peuvent indiquer un abus.",
  readOnly: "Lecture seule",
  clear: "Effacer les filtres",
};

const OUTCOME_TONE: Record<string, Tone> = { success: "good", denied: "bad", failed: "warn" };

type Response = { ok: true; rows: AuditEvent[]; total: number; page: number; pageSize: number; pages: number };

function ChangesList({ row, t }: { row: AuditEvent; t: Copy }) {
  const changes = row.changes ?? [];
  return (
    <div className="flex flex-col gap-2 text-sm">
      {row.detail ? (
        <p>
          <span className="font-semibold text-navy">{t.details}: </span>
          <span className="break-words text-navy/80">{row.detail}</span>
        </p>
      ) : null}
      {changes.length === 0 ? (
        <p className="text-navy/70">{t.noChanges}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {changes.map((change, index) => (
            <li key={`${change.field}-${index}`} className="break-words text-navy">
              {change.from === undefined && change.to === undefined
                ? t.changedNoValue.replace("{field}", change.field)
                : t.changeLine
                    .replace("{field}", change.field)
                    .replace("{from}", change.from ?? t.added)
                    .replace("{to}", change.to ?? t.removed)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AuditLogConsole() {
  const locale = useLocaleTag();
  const t: Copy = locale === "fr" ? fr : en;
  const common = useCommon();
  const loadError = useLoadErrorText();
  const { can, known } = useAdminPermissions();

  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const debouncedQ = useDebounced(q);
  const debouncedAction = useDebounced(action);

  const allowed = !known || can("audit.read");
  const url = `/api/admin/audit-logs${queryString({
    q: debouncedQ.trim(),
    action: debouncedAction.trim(),
    outcome,
    businessId,
    from,
    to,
    page,
    pageSize: 25,
  })}`;
  const { data, error, loading, refresh, updatedAt } = useAdminData<Response>(allowed ? url : null);

  const reset = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(1);
    setOpen(null);
  };
  const filtered = Boolean(q || action || outcome || businessId || from || to);

  const columns: Column<AuditEvent>[] = [
    { id: "when", header: t.when, primary: true, cell: (row) => formatDateTime(row.createdAt, locale) },
    {
      id: "who",
      header: t.who,
      cell: (row) => (
        <>
          <span className="block break-all">{row.actorEmail ?? t.system}</span>
          {row.actorRole ? <span className="block text-xs text-navy/70">{row.actorRole}</span> : null}
        </>
      ),
    },
    { id: "what", header: t.what, cell: (row) => <code className="break-all text-xs">{row.action}</code> },
    { id: "target", header: t.target, cell: (row) => <span className="break-all">{row.target ?? "—"}</span> },
    {
      id: "business",
      header: t.business,
      cell: (row) =>
        row.organizationId ? (
          <Link href={{ pathname: "/admin/businesses/[id]", params: { id: row.organizationId } }} className="break-all underline">
            {row.organizationId}
          </Link>
        ) : (
          <span className="text-navy/70">{t.platform}</span>
        ),
    },
    {
      id: "outcome",
      header: t.outcome,
      cell: (row) => {
        const value = row.outcome ?? "success";
        return <Badge tone={OUTCOME_TONE[value] ?? "neutral"}>{t.outcomes[value] ?? value}</Badge>;
      },
    },
    {
      id: "changes",
      header: t.changes,
      cell: (row) => {
        const count = row.changes?.length ?? 0;
        const expandable = count > 0 || Boolean(row.detail);
        if (!expandable) return <span className="text-navy/70">—</span>;
        return (
          <button
            type="button"
            className={secondaryButton}
            aria-expanded={open === row.id}
            onClick={() => setOpen((current) => (current === row.id ? null : row.id))}
          >
            {open === row.id ? t.hide : `${t.show}${count ? ` (${count})` : ""}`}
          </button>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.title}
        intro={t.intro}
        onRefresh={allowed ? refresh : undefined}
        loading={loading}
        updatedAt={updatedAt}
        actions={<Badge tone="info">{t.readOnly}</Badge>}
      />

      {!allowed ? (
        <Notice tone="warn">{t.noAccess}</Notice>
      ) : (
        <>
          <FilterBar>
            <Field label={common.search} htmlFor="af-q">
              <input id="af-q" type="search" value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder={t.search} className={inputClass} maxLength={100} />
            </Field>
            <Field label={t.action} htmlFor="af-action">
              <input id="af-action" value={action} onChange={(e) => reset(setAction)(e.target.value)} placeholder="business.update" className={inputClass} maxLength={80} autoComplete="off" />
            </Field>
            <Field label={t.outcome} htmlFor="af-outcome">
              <select id="af-outcome" value={outcome} onChange={(e) => reset(setOutcome)(e.target.value)} className={inputClass}>
                <option value="">{t.anyOutcome}</option>
                {Object.entries(t.outcomes).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <BusinessSelect id="af-business" label={t.business} value={businessId} onChange={reset(setBusinessId)} />
            <Field label={common.from} htmlFor="af-from">
              <input id="af-from" type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} className={inputClass} />
            </Field>
            <Field label={common.to} htmlFor="af-to">
              <input id="af-to" type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} className={inputClass} />
            </Field>
            {filtered ? (
              <div className="flex items-end">
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => { setQ(""); setAction(""); setOutcome(""); setBusinessId(""); setFrom(""); setTo(""); setPage(1); setOpen(null); }}
                >
                  {t.clear}
                </button>
              </div>
            ) : null}
          </FilterBar>

          <p className="text-xs text-navy/70">{t.suspicious}</p>

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
                <DataTable
                  columns={columns}
                  rows={data.rows}
                  rowKey={(row) => row.id}
                  caption={t.caption}
                  expanded={(row) => (open === row.id ? <ChangesList row={row} t={t} /> : null)}
                />
                <Pager page={data.page} pages={data.pages} total={data.total} onPage={(next) => { setPage(next); setOpen(null); }} busy={loading} />
              </>
            ) : null}
          </DataState>
        </>
      )}
    </div>
  );
}
