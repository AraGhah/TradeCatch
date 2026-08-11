import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTenantContext } from "@/product/saas/tenant";
import { orgHasFeature } from "@/product/saas/entitlements";
import { getGrowthStore } from "@/product/growth";
import { BookingForm } from "@/components/app/BookingForm";

export default async function AppBookingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app");

  const auth = await requireTenantContext();
  if (!auth.ok) return null;

  if (!orgHasFeature(auth.ctx.organization.plan, "APPOINTMENT_BOOKING")) {
    return <p className="text-navy/70">{t("bookings.entitlement")}</p>;
  }

  const appointments = await getGrowthStore().listAppointments(
    auth.ctx.organization.id,
  );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold text-navy">
          {t("bookings.headline")}
        </h1>
        <p className="mt-2 text-navy/70">{t("bookings.intro")}</p>
      </header>

      <BookingForm />

      {appointments.length === 0 ? (
        <p className="rounded-md border border-dashed border-navy/20 bg-white px-4 py-8 text-center text-navy/60">
          {t("bookings.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-navy/10 overflow-hidden rounded-md border border-navy/10 bg-white">
          {appointments.map((a) => (
            <li key={a.id} className="px-4 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-navy">{a.title}</p>
                <p className="text-xs uppercase tracking-wide text-navy/50">
                  {a.status}
                </p>
              </div>
              <p className="mt-1 text-sm text-navy/70">
                {a.customerName || a.customerPhoneE164 || "—"}
                {" · "}
                {new Date(a.startsAt).toLocaleString(
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
