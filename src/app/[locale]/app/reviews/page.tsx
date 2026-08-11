import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { orgHasFeature } from "@/product/saas/entitlements";
import { getGrowthStore } from "@/product/growth";
import { ReviewsActions } from "@/components/app/ReviewsActions";

export default async function AppReviewsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app");

  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  if (!orgHasFeature(auth.ctx.organization.plan, "REVIEW_AUTOMATION")) {
    return <p className="text-navy/70">{t("reviews.entitlement")}</p>;
  }

  const store = getGrowthStore();
  const orgId = auth.ctx.organization.id;
  const [reviews, settings, appointments] = await Promise.all([
    store.listReviewRequests(orgId),
    store.getOrgSettings(orgId),
    store.listAppointments(orgId),
  ]);

  const completable = appointments
    .filter((a) => a.status === "scheduled" || a.status === "confirmed")
    .map((a) => ({
      id: a.id,
      label: `${a.title} · ${new Date(a.startsAt).toLocaleString(
        locale === "fr" ? "fr-CA" : "en-CA",
      )}`,
    }));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("reviews.headline")}
        </h1>
        <p className="mt-2 text-navy/70">{t("reviews.intro")}</p>
      </header>

      <ReviewsActions
        googleReviewUrl={settings.googleReviewUrl}
        appointmentIds={completable}
      />

      {reviews.length === 0 ? (
        <p className="rounded-md border border-dashed border-navy/20 bg-white px-4 py-8 text-center text-navy/60">
          {t("reviews.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-navy/10 overflow-hidden rounded-md border border-navy/10 bg-white">
          {reviews.map((r) => (
            <li key={r.id} className="px-4 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-navy">
                  {r.customerName || r.customerPhoneE164}
                </p>
                <p className="text-xs uppercase tracking-wide text-navy/50">
                  {r.status}
                </p>
              </div>
              <p className="mt-1 text-sm text-navy/70">
                {r.customerPhoneE164}
                {" · "}
                {t("reviews.scheduled")}{" "}
                {new Date(r.scheduledFor).toLocaleString(
                  locale === "fr" ? "fr-CA" : "en-CA",
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
