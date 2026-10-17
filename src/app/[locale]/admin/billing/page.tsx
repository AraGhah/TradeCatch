import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatPlanMoney } from "@/lib/plans";
import { loadPlatformSnapshot } from "@/product/admin/platform-snapshot";

export const dynamic = "force-dynamic";

export default async function AdminBillingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin.platform");
  const snapshot = await loadPlatformSnapshot();
  const paying = snapshot.rows.filter((row) => row.accountType !== "demo");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">{t("billingHeadline")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-navy/70">{t("stripeNote")}</p>
        <p className="mt-2 text-sm text-navy">{snapshot.stripeConfigured ? t("stripeOn") : t("stripeOff")}</p>
      </header>
      <p className="font-[family-name:var(--font-archivo)] text-3xl font-extrabold text-navy">{formatPlanMoney(snapshot.mrr, locale)}</p>
      <div className="overflow-x-auto rounded-md border border-navy/10 bg-white">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="text-navy/60">
            <tr>
              <th className="px-3 py-2 font-medium">{t("businesses")}</th>
              <th className="px-3 py-2 font-medium">{t("plan")}</th>
              <th className="px-3 py-2 font-medium">{t("status")}</th>
              <th className="px-3 py-2 font-medium">{t("mrr")}</th>
            </tr>
          </thead>
          <tbody>
            {paying.map((row) => (
              <tr key={row.id} className="border-t border-navy/10">
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2">{row.plan}</td>
                <td className="px-3 py-2">{row.status}</td>
                <td className="px-3 py-2">{formatPlanMoney(row.monthly, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
