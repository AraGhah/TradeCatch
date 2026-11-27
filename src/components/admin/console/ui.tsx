"use client";

import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import { useLocale } from "next-intl";
import { LoadingRegion, SkeletonRows } from "@/components/ui/Skeleton";
import { BusyLabel } from "@/components/ui/Spinner";
import { AdminApiError, useAdminData } from "./api";

/**
 * The console's shared building blocks. Everything a view needs to be
 * consistent: header with a visible refresh, loading / empty / error states,
 * status badges that never rely on colour alone, a table that becomes cards on a
 * phone, pagination, and a confirmation panel for sensitive changes.
 */

// ---------------------------------------------------------------------------
// Copy and formatting
// ---------------------------------------------------------------------------

const en = {
  refresh: "Refresh",
  refreshing: "Refreshing…",
  updated: "Updated",
  loading: "Loading…",
  retry: "Try again",
  empty: "Nothing to show.",
  previous: "Previous",
  next: "Next",
  first: "First page",
  page: "Page",
  of: "of",
  results: "results",
  all: "All",
  cancel: "Cancel",
  confirm: "Confirm",
  working: "Working…",
  typeToConfirm: "Type {word} to confirm",
  confirmMismatch: "The word does not match.",
  close: "Close",
  view: "View",
  none: "None",
  yes: "Yes",
  no: "No",
  from: "From",
  to: "To",
  search: "Search",
  allBusinesses: "All businesses",
  filters: "Filters",
  clearFilters: "Clear filters",
  errNetwork: "The server could not be reached. Check your connection and try again.",
  errTimeout:
    "No answer arrived in time. If you were making a change, refresh and check its current state before trying again.",
  errSession: "Your session has ended. Sign in again to continue.",
  errForbidden: "Your administrator role does not allow this.",
  errRate: "Too many requests. Wait a moment and try again.",
  errServer: "Something went wrong on the server. Nothing was changed; try again shortly.",
  errBad: "Check the details and try again.",
  noAccessAction: "Your role cannot make this change.",
};
type Common = typeof en;
const fr: Common = {
  refresh: "Actualiser",
  refreshing: "Actualisation…",
  updated: "Mis à jour",
  loading: "Chargement…",
  retry: "Réessayer",
  empty: "Rien à afficher.",
  previous: "Précédent",
  next: "Suivant",
  first: "Première page",
  page: "Page",
  of: "sur",
  results: "résultats",
  all: "Tous",
  cancel: "Annuler",
  confirm: "Confirmer",
  working: "En cours…",
  typeToConfirm: "Saisissez {word} pour confirmer",
  confirmMismatch: "Le mot ne correspond pas.",
  close: "Fermer",
  view: "Voir",
  none: "Aucun",
  yes: "Oui",
  no: "Non",
  from: "Du",
  to: "Au",
  search: "Rechercher",
  allBusinesses: "Toutes les entreprises",
  filters: "Filtres",
  clearFilters: "Effacer les filtres",
  errNetwork: "Le serveur est injoignable. Vérifiez votre connexion et réessayez.",
  errTimeout:
    "Aucune réponse n’est arrivée à temps. Si vous faisiez une modification, actualisez et vérifiez son état actuel avant de réessayer.",
  errSession: "Votre session est terminée. Reconnectez-vous pour continuer.",
  errForbidden: "Votre rôle d’administrateur ne permet pas cette action.",
  errRate: "Trop de requêtes. Patientez un instant puis réessayez.",
  errServer: "Une erreur est survenue sur le serveur. Rien n’a été modifié; réessayez sous peu.",
  errBad: "Vérifiez les renseignements et réessayez.",
  noAccessAction: "Votre rôle ne permet pas ce changement.",
};

export function useLocaleTag(): "en" | "fr" {
  return useLocale() === "fr" ? "fr" : "en";
}

export function useCommon(): Common {
  return useLocaleTag() === "fr" ? fr : en;
}

/** A readable message for a failed request, in the viewer's language. */
export function useErrorText() {
  const t = useCommon();
  return (error: AdminApiError | undefined, specific?: Record<string, string>) => {
    if (!error) return "";
    if (error.code && specific?.[error.code]) return specific[error.code];
    if (error.code === "timeout") return t.errTimeout;
    if (error.status === 0) return t.errNetwork;
    if (error.status === 401) return t.errSession;
    if (error.status === 403) return t.errForbidden;
    if (error.status === 429) return t.errRate;
    if (error.status >= 500) return t.errServer;
    return specific?.default ?? t.errBad;
  };
}

/**
 * What a failed load says. Problems about the caller (offline, signed out, not
 * allowed, rate limited) are reported as such; anything else says which data
 * could not be loaded. Never claims "nothing was changed": a read changes nothing.
 */
export function useLoadErrorText() {
  const errorText = useErrorText();
  return (error: AdminApiError | undefined, fallback: string) => {
    if (!error) return "";
    // A timeout is status 0 too: it is about the connection, not about the data.
    return [0, 401, 403, 429].includes(error.status) ? errorText(error) : fallback;
  };
}

export function formatMoney(
  cents: number | null | undefined,
  currency: string | null | undefined,
  locale: string,
): string {
  if (cents === null || cents === undefined) return "—";
  try {
    return new Intl.NumberFormat(locale === "fr" ? "fr-CA" : "en-CA", {
      style: "currency",
      currency: currency || "CAD",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency ?? ""}`.trim();
  }
}

export function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    dateStyle: "medium",
  }).format(date);
}

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------

export const inputClass =
  "w-full min-h-10 rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-navy placeholder:text-navy/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 disabled:cursor-not-allowed disabled:bg-navy/5 disabled:text-navy/60";

export const primaryButton =
  "inline-flex min-h-10 items-center justify-center rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export const secondaryButton =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-navy/25 bg-white px-4 py-2 text-sm font-semibold text-navy hover:bg-navy/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60 disabled:cursor-not-allowed disabled:opacity-50";

export const dangerButton =
  "inline-flex min-h-10 items-center justify-center rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export const card = "rounded-md border border-navy/10 bg-white p-4";

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";

const TONE: Record<Tone, string> = {
  neutral: "border-navy/20 bg-navy/5 text-navy",
  good: "border-green-300 bg-green-50 text-green-900",
  warn: "border-amber-300 bg-amber-50 text-amber-900",
  bad: "border-red-300 bg-red-50 text-red-900",
  info: "border-sky-300 bg-sky-50 text-sky-900",
};

const MARK: Record<Tone, string> = {
  neutral: "•",
  good: "✓",
  warn: "!",
  bad: "✕",
  info: "i",
};

/** A status chip. The symbol and the words carry the meaning; colour only reinforces it. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE[tone]}`}
    >
      <span aria-hidden="true">{MARK[tone]}</span>
      {children}
    </span>
  );
}

export function Notice({
  tone = "info",
  children,
  onClose,
}: {
  tone?: Tone;
  children: ReactNode;
  onClose?: () => void;
}) {
  const t = useCommon();
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm ${TONE[tone]}`}
    >
      <div className="min-w-0 break-words">{children}</div>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded px-1 text-xs font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/60"
        >
          {t.close}
        </button>
      ) : null}
    </div>
  );
}

export function PageHeader({
  title,
  intro,
  onRefresh,
  loading,
  updatedAt,
  actions,
}: {
  title: string;
  intro?: string;
  onRefresh?: () => void;
  loading?: boolean;
  updatedAt?: number;
  actions?: ReactNode;
}) {
  const t = useCommon();
  const locale = useLocaleTag();
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-extrabold text-navy md:text-3xl">
          {title}
        </h1>
        {intro ? <p className="mt-2 max-w-2xl text-sm text-navy/70">{intro}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {updatedAt ? (
          <p className="text-xs text-navy/70" aria-live="polite">
            {t.updated} {formatDateTime(new Date(updatedAt).toISOString(), locale)}
          </p>
        ) : null}
        {actions}
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-busy={loading}
            className={secondaryButton}
          >
            <BusyLabel pending={Boolean(loading)} busyLabel={t.refreshing}>
              {t.refresh}
            </BusyLabel>
          </button>
        ) : null}
      </div>
    </header>
  );
}

/**
 * Wraps a data region with its loading, error and empty states. Existing data
 * stays on screen while a newer request is in flight (dimmed, `aria-busy`), so
 * filtering and paging do not flash blank.
 */
export function DataState({
  loading,
  error,
  hasData,
  empty,
  onRetry,
  errorText,
  loadingLabel,
  skeleton,
  children,
}: {
  loading: boolean;
  error?: AdminApiError;
  hasData: boolean;
  /** True when the data is there but has no rows. */
  empty?: boolean;
  onRetry: () => void;
  errorText: string;
  /** What is loading, in words: "Loading customers…". Defaults to "Loading…". */
  loadingLabel?: string;
  /** A placeholder shaped like the data (tiles, rows). Defaults to table rows. */
  skeleton?: ReactNode;
  children: ReactNode;
}) {
  const t = useCommon();
  if (!hasData && loading) {
    // A placeholder of the data's rough shape, so the page does not jump when it
    // arrives and there is no full-page spinner.
    return (
      <LoadingRegion label={loadingLabel ?? t.loading}>
        {skeleton ?? <SkeletonRows rows={5} columns={4} />}
      </LoadingRegion>
    );
  }
  if (!hasData && error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-red-300 bg-red-50 px-4 py-4 text-sm text-red-900">
        <p>{errorText}</p>
        <button type="button" onClick={onRetry} className={secondaryButton}>
          {t.retry}
        </button>
      </div>
    );
  }
  return (
    <div aria-busy={loading} className={`flex flex-col gap-3 ${loading ? "opacity-60" : ""}`}>
      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          <p>{errorText}</p>
          <button type="button" onClick={onRetry} className={secondaryButton}>
            {t.retry}
          </button>
        </div>
      ) : null}
      {empty ? (
        <p className="rounded-md border border-navy/10 bg-white px-4 py-6 text-sm text-navy/70">{t.empty}</p>
      ) : (
        children
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-navy">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-navy/70">{hint}</p> : null}
      {error ? <p className="text-xs font-medium text-red-800">{error}</p> : null}
    </div>
  );
}

export function Pager({
  page,
  pages,
  total,
  onPage,
  busy,
}: {
  page: number;
  pages: number;
  total?: number;
  onPage: (page: number) => void;
  busy?: boolean;
}) {
  const t = useCommon();
  if (pages <= 1 && !total) return null;
  return (
    <nav aria-label={t.page} className="flex flex-wrap items-center justify-between gap-3 text-sm text-navy">
      <p>
        {t.page} {page} {t.of} {pages}
        {total !== undefined ? ` · ${total} ${t.results}` : ""}
      </p>
      <div className="flex gap-2">
        <button type="button" className={secondaryButton} disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>
          {t.previous}
        </button>
        <button type="button" className={secondaryButton} disabled={busy || page >= pages} onClick={() => onPage(page + 1)}>
          {t.next}
        </button>
      </div>
    </nav>
  );
}

/** Cursor paging (Stripe lists): back to the start, or on to the next page. */
export function CursorPager({
  hasPrevious,
  hasNext,
  onFirst,
  onNext,
  busy,
}: {
  hasPrevious: boolean;
  hasNext: boolean;
  onFirst: () => void;
  onNext: () => void;
  busy?: boolean;
}) {
  const t = useCommon();
  if (!hasPrevious && !hasNext) return null;
  return (
    <div className="flex gap-2">
      <button type="button" className={secondaryButton} disabled={busy || !hasPrevious} onClick={onFirst}>
        {t.first}
      </button>
      <button type="button" className={secondaryButton} disabled={busy || !hasNext} onClick={onNext}>
        {t.next}
      </button>
    </div>
  );
}

const WIDE_QUERY = "(min-width: 768px)";
function subscribeWide(onChange: () => void) {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
/** Whether the table layout is the visible one. The server renders for wide screens. */
function useWide() {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => true);
}

export type Column<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Shown as the card's title on a phone instead of a labelled row. */
  primary?: boolean;
  className?: string;
};

/**
 * A table on wide screens and a list of cards on a phone, so nothing needs a
 * sideways scroll. `expanded` puts extra content (an action panel, a detail)
 * directly under its row or card.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  expanded,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  expanded?: (row: T) => ReactNode;
  caption: string;
}) {
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary);
  // Both layouts are in the page (CSS shows one), but extra content such as a
  // confirmation panel or a detail view has state, so only the visible layout mounts it.
  const wide = useWide();
  return (
    <>
      <div className="hidden overflow-x-auto rounded-md border border-navy/10 bg-white md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-navy/5 text-navy/80">
            <tr>
              {columns.map((c) => (
                <th key={c.id} scope="col" className={`px-3 py-2 font-semibold ${c.className ?? ""}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const extra = wide ? expanded?.(row) : null;
              return (
                <Fragment key={rowKey(row)}>
                  <tr className="border-t border-navy/10 align-top">
                    {columns.map((c) => (
                      <td key={c.id} className={`px-3 py-2 ${c.className ?? ""}`}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                  {extra ? (
                    <tr className="border-t border-navy/10 bg-navy/[0.03]">
                      <td colSpan={columns.length} className="px-3 py-3">
                        {extra}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-3 md:hidden" aria-label={caption}>
        {rows.map((row) => {
          const extra = wide ? null : expanded?.(row);
          return (
            <li key={rowKey(row)} className="rounded-md border border-navy/10 bg-white p-3 text-sm">
              <div className="min-w-0 break-words font-semibold text-navy">{primary.cell(row)}</div>
              <dl className="mt-2 grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                {rest.map((c) => (
                  <div key={c.id} className="contents">
                    <dt className="text-navy/70">{c.header}</dt>
                    <dd className="min-w-0 break-words text-navy">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
              {extra ? <div className="mt-3 border-t border-navy/10 pt-3">{extra}</div> : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * Confirmation for a sensitive change. When `word` is given the administrator
 * must type it exactly; the confirm button stays disabled until they do and while
 * the change is running, so it cannot be sent twice.
 */
export function ConfirmPanel({
  title,
  description,
  word,
  confirmLabel,
  busy,
  error,
  tone = "primary",
  onConfirm,
  onCancel,
}: {
  title: string;
  description?: ReactNode;
  word?: string;
  confirmLabel: string;
  busy: boolean;
  error?: string;
  tone?: "primary" | "danger";
  onConfirm: (typed: string) => void;
  onCancel: () => void;
}) {
  const t = useCommon();
  const id = useId();
  const [typed, setTyped] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const ready = !word || typed.trim().toLowerCase() === word.toLowerCase();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready && !busy) onConfirm(typed.trim());
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onCancel();
      }}
      aria-labelledby={`${id}-title`}
      className="flex max-w-xl flex-col gap-3 rounded-md border border-navy/20 bg-white p-3"
    >
      <p id={`${id}-title`} className="text-sm font-semibold text-navy">
        {title}
      </p>
      {description ? <div className="text-sm text-navy/80">{description}</div> : null}
      {word ? (
        <Field label={t.typeToConfirm.replace("{word}", `“${word}”`)} htmlFor={`${id}-word`}>
          <input
            id={`${id}-word`}
            ref={input}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
            className={inputClass}
          />
        </Field>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-800">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!ready || busy}
          aria-busy={busy}
          className={tone === "danger" ? dangerButton : primaryButton}
        >
          <BusyLabel pending={busy} busyLabel={t.working}>
            {confirmLabel}
          </BusyLabel>
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={secondaryButton}>
          {t.cancel}
        </button>
      </div>
    </form>
  );
}

type BusinessOption = { id: string; name: string };

/** A picker over up to 100 businesses, newest first. Used by every business filter. */
export function BusinessSelect({
  value,
  onChange,
  id,
  label,
}: {
  value: string;
  onChange: (id: string) => void;
  id: string;
  label: string;
}) {
  const t = useCommon();
  const { data } = useAdminData<{ rows: BusinessOption[]; total: number }>(
    "/api/admin/businesses?pageSize=100",
  );
  const rows = data?.rows ?? [];
  const known = rows.some((row) => row.id === value);
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}>
        <option value="">{t.allBusinesses}</option>
        {value && !known ? <option value={value}>{value}</option> : null}
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** A responsive filter row: stacked on a phone, a wrapping grid on wider screens. */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3 rounded-md border border-navy/10 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </div>
  );
}

/** Tiles of key figures. */
export function Tile({
  label,
  value,
  note,
  tone,
  href,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: Tone;
  href?: ReactNode;
}) {
  return (
    <div className={`rounded-md border px-4 py-3 ${tone && tone !== "neutral" ? TONE[tone] : "border-navy/10 bg-white"}`}>
      <p className="text-sm text-navy/70">{label}</p>
      <p className="mt-1 font-heading text-2xl font-extrabold text-navy">{value}</p>
      {note ? <p className="mt-1 text-xs text-navy/70">{note}</p> : null}
      {href ? <div className="mt-2 text-xs">{href}</div> : null}
    </div>
  );
}
