import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { orgHasFeature } from "@/product/saas/entitlements";
import { getGrowthStore } from "@/product/growth";

export default async function AppTimelinePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app");

  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  const canView =
    orgHasFeature(auth.ctx.organization.plan, "HUMAN_TAKEOVER") ||
    orgHasFeature(auth.ctx.organization.plan, "BASIC_ANALYTICS");
  if (!canView) {
    return <p className="text-navy/70">{t("timeline.entitlement")}</p>;
  }

  const events = await getGrowthStore().listTimeline(
    auth.ctx.organization.id,
    100,
  );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("timeline.headline")}
        </h1>
        <p className="mt-2 text-navy/70">{t("timeline.intro")}</p>
      </header>

      {events.length === 0 ? (
        <p className="rounded-md border border-dashed border-navy/20 bg-white px-4 py-8 text-center text-navy/60">
          {t("timeline.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-navy/10 overflow-hidden rounded-md border border-navy/10 bg-white">
          {events.map((e) => (
            <li key={e.id} className="px-4 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-navy">{e.title}</p>
                <p className="text-xs text-navy/50">
                  {new Date(e.at).toLocaleString(
                    locale === "fr" ? "fr-CA" : "en-CA",
                  )}
                </p>
              </div>
              <p className="mt-1 text-sm text-navy/70">
                {e.kind}
                {e.detail ? ` · ${e.detail}` : ""}
                {` · ${e.actor}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
