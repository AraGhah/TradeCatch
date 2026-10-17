import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatPlanMoney } from "@/lib/plans";
import { filterPlatformRows, pageRows } from "@/product/admin/platform-stats";
import { loadPlatformSnapshot } from "@/product/admin/platform-snapshot";

export const dynamic = "force-dynamic";

export default async function AdminBusinessesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; status?: string; plan?: string; page?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("admin.platform");
  const snapshot = await loadPlatformSnapshot();
  const filtered = filterPlatformRows(snapshot.rows, {
    q: query.q,
    status: query.status,
    plan: query.plan,
  });
  const paged = pageRows(filtered, Number(query.page) || 1);
  const statusLabel = (status: string) =>
    status === "active" ? t("activeStatus") : status === "suspended" ? t("suspendedStatus") : t("churnedStatus");

  function href(page: number) {
    const next = new URLSearchParams();
    if (query.q) next.set("q", query.q);
    if (query.status) next.set("status", query.status);
    if (query.plan) next.set("plan", query.plan);
    next.set("page", String(page));
    return `?${next.toString()}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{t("navBusinesses")}</h1>
        <p className="mt-2 text-sm text-navy/70">{t("noPassword")}</p>
      </header>
      <form className="flex flex-wrap gap-2" method="get">
        <input name="q" defaultValue={query.q ?? ""} placeholder={t("search")} className="rounded-md border border-navy/15 px-2 py-1.5 text-sm" />
        <select name="status" defaultValue={query.status ?? ""} className="rounded-md border border-navy/15 px-2 py-1.5 text-sm">
          <option value="">{t("all")}</option>
          <option value="active">{t("activeStatus")}</option>
          <option value="suspended">{t("suspendedStatus")}</option>
          <option value="churned">{t("churnedStatus")}</option>
        </select>
        <select name="plan" defaultValue={query.plan ?? ""} className="rounded-md border border-navy/15 px-2 py-1.5 text-sm">
          <option value="">{t("all")}</option>
          <option value="starter">Starter</option>
          <option value="growth">Growth</option>
        </select>
        <button type="submit" className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white">{t("filter")}</button>
      </form>
      {paged.rows.length === 0 ? <p className="text-sm text-navy/60">{t("empty")}</p> : (
        <div className="overflow-x-auto rounded-md border border-navy/10 bg-white">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="text-navy/60">
              <tr>
                <th className="px-3 py-2 font-medium">{t("businesses")}</th>
                <th className="px-3 py-2 font-medium">{t("plan")}</th>
                <th className="px-3 py-2 font-medium">{t("status")}</th>
                <th className="px-3 py-2 font-medium">{t("mrr")}</th>
                <th className="px-3 py-2 font-medium">{t("leads")}</th>
                <th className="px-3 py-2 font-medium">{t("calls")}</th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((row) => (
                <tr key={row.id} className="border-t border-navy/10">
                  <td className="px-3 py-2">
                    <Link href={{ pathname: "/admin/businesses/[id]", params: { id: row.id } }} className="font-semibold text-navy underline">
                      {row.name}
                    </Link>
                    <span className="block text-xs text-navy/50">{row.city}</span>
                  </td>
                  <td className="px-3 py-2">{row.plan}</td>
                  <td className="px-3 py-2">{statusLabel(row.status)}</td>
                  <td className="px-3 py-2">{formatPlanMoney(row.monthly, locale)}</td>
                  <td className="px-3 py-2">{row.leads}</td>
                  <td className="px-3 py-2">{row.calls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex gap-3 text-sm">
        {paged.page > 1 ? <a className="underline" href={href(paged.page - 1)}>{t("previous")}</a> : null}
        {paged.page < paged.pages ? <a className="underline" href={href(paged.page + 1)}>{t("next")}</a> : null}
      </div>
    </div>
  );
}
