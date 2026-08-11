import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  FEATURE_LABELS,
  featuresForPlan,
  growthUpsellFeatures,
  orgHasFeature,
} from "@/product/saas/entitlements";
import { requireTenantContext } from "@/product/saas/tenant";

export default async function AppSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app");
  const lang = locale === "fr" ? "fr" : "en";

  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  const included = featuresForPlan(auth.ctx.organization.plan);
  const locked = growthUpsellFeatures().filter(
    (f) => !orgHasFeature(auth.ctx.organization.plan, f),
  );

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("settings.headline")}
        </h1>
        <p className="mt-2 text-navy/70">{t("settings.intro")}</p>
      </header>

      <section className="rounded-md border border-navy/10 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
          {t("settings.plan")}
        </h2>
        <p className="mt-2 text-lg font-semibold text-navy">
          {auth.ctx.organization.plan === "growth"
            ? t("plan.growth")
            : t("plan.starter")}
        </p>
        <p className="mt-1 text-sm text-navy/60">
          {auth.ctx.organization.name} · {auth.ctx.user.email}
        </p>
        {auth.ctx.organization.missedCallClientId ? (
          <p className="mt-2 text-xs text-navy/50">
            {t("settings.clientLinked")}:{" "}
            {auth.ctx.organization.missedCallClientId}
          </p>
        ) : (
          <p className="mt-2 text-sm text-navy/70">{t("dashboard.notLinked")}</p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
          {t("settings.included")}
        </h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {included.map((f) => (
            <li
              key={f}
              className="rounded-md border border-navy/10 bg-white px-3 py-2 text-sm text-navy"
            >
              {FEATURE_LABELS[f][lang]}
            </li>
          ))}
        </ul>
      </section>

      {locked.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy/50">
            {t("settings.growthOnly")}
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {locked.map((f) => (
              <li
                key={f}
                className="rounded-md border border-dashed border-navy/20 bg-white/60 px-3 py-2 text-sm text-navy/60"
              >
                {FEATURE_LABELS[f][lang]}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
